import { type config, ConnectionPool, Transaction } from 'mssql';

export interface TransactionWrapper extends Transaction, AsyncDisposable {
    commit$: () => Promise<void>;
}

const isAborted = (transaction: Transaction): boolean =>
    (transaction as unknown as { _aborted?: boolean })._aborted === true;

// The wrappers extend the mssql object itself instead of copying it: mssql keeps updating the original
// (e.g. `_aborted` when SQL Server rolls back a deadlock victim), so a copy would go stale.
// biome-ignore lint/complexity/useArrowFunction: arrow functions cannot be called with `new`
export const TransactionWrapper = function(transaction: Transaction) {
    let committed: boolean = false;

    return Object.assign(transaction, {
        async commit$() {
            await transaction.commit();
            committed = true;
        },
        async [Symbol.asyncDispose]() {
            // SQL Server already rolled it back (deadlock victim, XACT_ABORT): rolling back again would
            // fail and hide the original error behind a SuppressedError.
            if (!committed && !isAborted(transaction)) {
                await transaction.rollback();
            }
        },
    });
} as unknown as new (transaction: Transaction) => TransactionWrapper;

export interface ConnectionPoolWrapper extends ConnectionPool, AsyncDisposable {
    transaction$: () => Promise<TransactionWrapper>;
}

// biome-ignore lint/complexity/useArrowFunction: arrow functions cannot be called with `new`
export const ConnectionPoolWrapper = function(conn: ConnectionPool) {
    return Object.assign(conn, {
        async transaction$() {
            const transaction = await conn.transaction().begin();
            return new TransactionWrapper(transaction);
        },
        async [Symbol.asyncDispose]() {
            await conn.close();
        },
    });
} as unknown as new (conn: ConnectionPool) => ConnectionPoolWrapper;

export type Pool = {
    connect: (partialConfig: Partial<config>) => () => Promise<ConnectionPool>;
}

export function Pool(poolConfig: config): Pool {
    const POOL: Record<string, () => Promise<ConnectionPool>> = {};

    return {
        connect: (partialConfig: Partial<config>) => {
            const config = { ...poolConfig, ...partialConfig };
            const database = config.database;

            if (!database) {
                throw new Error('Database name is required');
            }

            if (!(database in POOL)) {
                const pool = new ConnectionPool(config);
                const close = pool.close.bind(pool);

                pool.close = async () => {
                    delete POOL[database];
                    return await close();
                }

                // Throwing here would be an uncaught exception: this fires outside any caller's
                // promise (e.g. when ForceClose drops the socket of a busy connection).
                pool.on('error', () => {
                    delete POOL[database];
                });

                POOL[database] = () => pool
                    .connect()
                    .then(() => pool)
                    .catch(err => {
                        delete POOL[database];
                        throw err;
                    });
            }

            return POOL[database]!;
        },
    }
}

type TarnPool = { used: { resource: { close(): void } }[] };

// Connections checked out of the pool: held by an open transaction or a running request.
const busyConnections = (conn: ConnectionPool) => (conn as unknown as { pool?: TarnPool }).pool?.used ?? [];

export function HasBusyConnections(conn: ConnectionPool): boolean {
    return busyConnections(conn).length > 0;
}

/**
 * Closes every busy connection at the socket level. Their running requests fail right away and SQL Server
 * rolls back any open transaction. `close()` alone would wait forever for a connection held by a transaction.
 */
export function ForceClose(conn: ConnectionPool): void {
    for (const used of busyConnections(conn)) {
        used.resource.close();
    }
    // Not awaited: it only resolves once the caller's code lets go of its transaction.
    conn.close().catch(() => { });
}

import type { config, ConnectionPool, Transaction } from 'mssql';
import mssql from 'mssql';

export interface TransactionWrapper extends Transaction, AsyncDisposable {
    commit$: () => Promise<void>;
}

const isAborted = (transaction: Transaction): boolean =>
    (transaction as unknown as { _aborted?: boolean })._aborted === true;

// biome-ignore lint/complexity/useArrowFunction: arrow functions cannot be called with `new`
export const TransactionWrapper = function(transaction: Transaction) {
    let committed: boolean = false;

    return Object.assign(transaction, {
        async commit$() {
            await transaction.commit();
            committed = true;
        },
        async [Symbol.asyncDispose]() {
            // Extended in place, not copied: mssql flags `_aborted` on this object when SQL Server rolls back
            // a deadlock victim, and rolling back again would hide the deadlock behind a SuppressedError.
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
                const pool = new mssql.ConnectionPool(config);
                const close = pool.close.bind(pool);

                pool.close = async () => {
                    delete POOL[database];
                    return await close();
                }

                // Must not throw: it fires outside any promise (e.g. when ForceClose drops a socket).
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

const busyConnections = (conn: ConnectionPool) => (conn as unknown as { pool?: TarnPool }).pool?.used ?? [];

export function HasBusyConnections(conn: ConnectionPool): boolean {
    return busyConnections(conn).length > 0;
}

// close() waits forever for a connection held by a transaction; closing the socket makes SQL Server roll it back.
export function ForceClose(conn: ConnectionPool): void {
    for (const used of busyConnections(conn)) {
        used.resource.close();
    }
    conn.close().catch(() => { });
}

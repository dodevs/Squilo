import { type config, ConnectionPool, Transaction } from 'mssql';

export interface TransactionWrapper extends Transaction, AsyncDisposable {
    commit$: () => Promise<void>;
}

export const TransactionWrapper = function(this: TransactionWrapper, transaction: Transaction) {
    Object.setPrototypeOf(this, Object.getPrototypeOf(transaction));
    Object.assign(this, transaction);
    
    let committed: boolean = false;

    this.commit$ = async function() {
        committed = true;
        return await this.commit();
    };

    this[Symbol.asyncDispose] = async function() {
        if (!committed) {
            return await this.rollback();
        }
    };
} as unknown as new (transaction: Transaction) => TransactionWrapper & Transaction;

export interface ConnectionPoolWrapper extends ConnectionPool, AsyncDisposable {
    transaction$: () => Promise<TransactionWrapper>;
}

export const ConnectionPoolWrapper = function(this: ConnectionPoolWrapper, conn: ConnectionPool) {
    Object.setPrototypeOf(this, Object.getPrototypeOf(conn));
    Object.assign(this, conn);

    this.transaction$ = async function() {
        const transaction = await this.transaction().begin();
        return new TransactionWrapper(transaction);
    };

    this[Symbol.asyncDispose] = async function() {
        return await this.close();
    };
} as unknown as new (conn: ConnectionPool) => ConnectionPoolWrapper & ConnectionPool;

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

                pool.on('error', err => {
                    delete POOL[database];
                    throw err;
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
import { type config, ConnectionPool } from 'mssql';
export type Pool = {
    connect: (partialConfig: Partial<config>) => Promise<ConnectionPool>;
    closeAll: () => Promise<void>;
}

export function Pool(poolConfig: config): Pool {
    const POOL: Record<string, Promise<ConnectionPool>> = {};

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

                POOL[database] = pool
                    .connect()
                    .catch(err => {
                        delete POOL[database];
                        throw err;
                    });
            }

            return POOL[database]!;
        },
        closeAll: async () => {
            const closes = Object.values(POOL).map(pool => pool.then(p => p.close()));
            await Promise.all(closes);
        }

    }
}
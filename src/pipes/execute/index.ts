import type { Transaction } from 'mssql';
import type { DatabaseConnection } from "../connect/types";
import { Presets, SingleBar } from 'cli-progress';

export const Execute = <TParam>(
    connections$: (databases: string[]) => Generator<DatabaseConnection[]>, 
    databases$: Promise<string[]>,
    input: TParam
) => {
    return async (
        fn: (transaction: Transaction, database: string, params: TParam) => Promise<void>
    ): Promise<void> => {
        const singlerBar = new SingleBar({
            format: `{bar} {percentage}% | {value}/{total} | {database}`
        }, Presets.shades_classic);

        const executeFn = async (dc: DatabaseConnection): Promise<void> => {
            const opened = await dc.connection;
            const transaction = opened.transaction()
            try {
                await transaction.begin();
                await fn(transaction, dc.database, input);
                await transaction.commit();
                if (Bun.env.NODE_ENV !== 'test') {
                    singlerBar.increment(1, { database: dc.database });
                }
            } 
            catch (error) {
                await transaction.rollback();
            }
        };

        const databases = await databases$;

        if (Bun.env.NODE_ENV !== 'test') {
            singlerBar.start(databases.length, 0);
        }

        for (const connectionBatch of connections$(databases)) {
            const executions = connectionBatch.map(executeFn);
            await Promise.allSettled(executions);
        }

        if (Bun.env.NODE_ENV !== 'test') {
            singlerBar.stop();
        }
    };
};
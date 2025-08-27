import type { Transaction } from 'mssql';
import type { DatabaseConnection } from "../connect/types";

export const Execute = <TParam>(
    connections$: (databases: string[]) => Generator<DatabaseConnection[]>, 
    databases$: Promise<string[]>,
    input: TParam
) => {
    return async (
        fn: (transaction: Transaction, database: string, params: TParam) => Promise<void>
    ): Promise<void> => {
        const executeFn = async (dc: DatabaseConnection): Promise<void> => {
            const opened = await dc.connection;
            const transaction = opened.transaction()
            try {
                await transaction.begin();
                await fn(transaction, dc.database, input);
                await transaction.commit();
            } 
            catch (error) {
                await transaction.rollback();
            }
        };

        const databases = await databases$;

        for (const connectionBatch of connections$(databases)) {
            const executions = connectionBatch.map(executeFn);
            await Promise.allSettled(executions);
        }
    };
};
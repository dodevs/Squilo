import mssql from 'mssql';
import type { DatabaseConnection } from "../connect";

export const Execute = <TParam>(
    connections$: AsyncGenerator<DatabaseConnection[]>, 
    input: TParam
) => {
    return async (
        fn: (transaction: mssql.Transaction, database: string, params: TParam) => Promise<void>
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

        for await (const connectionBatch of connections$) {
            const executions = connectionBatch.map(executeFn);
            await Promise.allSettled(executions);
        }
    };
};
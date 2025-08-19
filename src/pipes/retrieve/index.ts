import type { Transaction } from "mssql";
import { type OutputStrategy, Output } from "../output";
import type { DatabaseConnection } from "../connect";

export type RetrieveChain<TReturn> = {
    Output<TOutput>(strategy: OutputStrategy<TReturn, TOutput>): Promise<TOutput>;
}

export const Retrieve = <TParam>(connections$: AsyncGenerator<DatabaseConnection[]>, input: TParam) => {
    return <TReturn>(fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>): RetrieveChain<TReturn> => {
        const { readable, writable } = new TransformStream<Record<string, TReturn>, Record<string, TReturn>>();
        const writer = writable.getWriter();

        const executeFn = async (dc: DatabaseConnection) => {
            const opened = await dc.connection;
            const transaction = opened.transaction();
            try {
                await transaction.begin();
                const result = await fn(transaction, dc.database, input);
                await writer.write({ [dc.database]: result });
                transaction.commit();
            } catch (error) {
                // TODO: Append client name and error in a structured json file
                transaction.rollback();
            }
        };

        // Process all connections and close the stream when done
        (async () => {
            try {
                for await (const connectionBatch of connections$) {
                    const executions = connectionBatch.map(executeFn);
                    await Promise.all(executions);
                }
                // Close the writer when all connections are processed
                await writer.close();
            } catch (error) {
                // If there's an error in processing connections, abort the writer
                writer.abort(error);
            }
        })();

        return {
            Output: Output(readable)
        };
    }
}
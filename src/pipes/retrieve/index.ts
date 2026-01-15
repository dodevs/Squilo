import type { Transaction } from "mssql";
import { Output } from "../output"
import type { DatabaseConnection } from "../connect/types";
import type { RetrieveChain } from "./types";
import { Runner } from "../shared/runner";
import type { ExecutionData, ExecutionError } from "../shared/runner/types";

export const Retrieve = <TParam>(
    connections$: (databases: string[]) => Generator<DatabaseConnection[]>,
    databases$: Promise<string[]>,
    input: TParam
) => {
    return <TReturn>(fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>): RetrieveChain<TReturn> => {
        const { readable: readableData, writable: writableData } = new TransformStream<ExecutionData<TReturn>, ExecutionData<TReturn>>();
        const { readable: readableError, writable: writableError } = new TransformStream<ExecutionError, ExecutionError>();
        const dataWriter = writableData.getWriter();
        const errorWriter = writableError.getWriter();

        const [runner, singleBar] = Runner();

        const executeFn = (dc: DatabaseConnection) => runner({
            connection: dc,
            input,
            fn,
            onSuccess: async (result) => {
                await dataWriter.write({ database: dc.database, data: result });
            },
            onError: async (error) => {
                await errorWriter.write({ [dc.database]: error });
            }
        });

        // Process all connections and close the stream when done
        (async () => {
            const databases = await databases$;

            if (Bun.env.NODE_ENV !== 'test') {
                singleBar.start(databases.length, 0);
            }

            for await (const connectionBatch of connections$(databases)) {
                const executions = connectionBatch.map(executeFn);
                await Promise.allSettled(executions);
            }

            if (Bun.env.NODE_ENV !== 'test') {
                singleBar.stop();
            }

            await dataWriter.close();
            await errorWriter.close();
        })();

        return {
            Output: Output(readableData, readableError)
        };
    }
}
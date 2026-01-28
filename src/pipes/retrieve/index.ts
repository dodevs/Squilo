import type { Transaction } from "mssql";
import { Output } from "../output"
import { Transform } from "../transform"
import type { DatabaseConnection } from "../connect/types";
import type { RetrieveChain } from "./types";
import { Runner } from "../shared/runner";
import type { ExecutionResult } from "../shared/runner/types";

export const Retrieve = <T>(
    connections$: (databases: T[]) => Generator<DatabaseConnection<T>[]>,
    databases$: Promise<T[]>
) => {
    return <TReturn>(fn: (transaction: Transaction, database: T) => Promise<TReturn>): RetrieveChain<T, TReturn> => {
        const { readable: readableResult, writable: writableResult } = new TransformStream<ExecutionResult<T, TReturn>, ExecutionResult<T, TReturn>>();
        const resultWriter = writableResult.getWriter();

        const [runner, singleBar] = Runner<T>();

        const executeFn = (dc: DatabaseConnection<T>) => runner({
            connection: dc,
            fn,
            onResult: async (data, error) => {
                await resultWriter.write({ database: dc.database, data: data, error: error });
            }
        });

        // Process all connections and close the stream when done
        (async () => {
            const databases = await databases$;

            if (Bun.env.NODE_ENV !== 'test') {
                singleBar.start(databases.length, 0);
            }

            for (const connectionBatch of connections$(databases)) {
                const executions = connectionBatch.map(executeFn);
                await Promise.allSettled(executions);
            }

            if (Bun.env.NODE_ENV !== 'test') {
                singleBar.stop();
            }

            await resultWriter.close().catch(() => {});
        })();

        return {
            Transform: Transform(readableResult),
            Output: Output(readableResult)
        };
    }
}
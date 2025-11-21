import type { Transaction } from "mssql";
import { Output } from "../output"
import type { DatabaseConnection } from "../connect/types";
import type { RetrieveChain } from "./types";
import { Presets, SingleBar } from "cli-progress";
import { LoadEnv } from "../../utils/load-env";
import { AppendError, CleanErrors, type ErrorType } from "../../utils/append-error";

const ENV = LoadEnv();
let ERRORS_COUNT = 0;

export const Retrieve = <TParam>(
    connections$: (databases: string[]) => Generator<DatabaseConnection[]>,
    databases$: Promise<string[]>,
    input: TParam
) => {
    return <TReturn>(fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>): RetrieveChain<TReturn> => {
        const { readable, writable } = new TransformStream<Record<string, TReturn>, Record<string, TReturn>>();
        const writer = writable.getWriter();

        const singlerBar = new SingleBar({
            format: `{bar} {percentage}% | {value}/{total} | {database}`
        }, Presets.shades_classic);

        const executeFn = async (dc: DatabaseConnection) => {
            const opened = await dc.connection;
            const transaction = opened.transaction();
            try {
                await transaction.begin();
                const result = await fn(transaction, dc.database, input);
                transaction.commit();

                await writer.write({ [dc.database]: result });

                if (Bun.env.NODE_ENV !== 'test') {
                    singlerBar.increment(1, { database: dc.database });
                }
            } catch (error) {
                await transaction.rollback();
                await AppendError(dc.database, error as ErrorType);

                if (++ERRORS_COUNT > ENV.MAX_ERRORS) {
                    await writable.abort(error as ErrorType);
                    console.error('Max errors reached, exiting...');
                    process.exit(1);
                }
            }
        };

        // Process all connections and close the stream when done
        (async () => {
            await CleanErrors();
            const databases = await databases$;

            if (Bun.env.NODE_ENV !== 'test') {
                singlerBar.start(databases.length, 0);
            }

            for await (const connectionBatch of connections$(databases)) {
                const executions = connectionBatch.map(executeFn);
                await Promise.allSettled(executions);
            }

            if (Bun.env.NODE_ENV !== 'test') {
                singlerBar.stop();
            }

            // Close the writer when all connections are processed
            await writer.close();
        })();

        return {
            Output: Output(readable)
        };
    }
}
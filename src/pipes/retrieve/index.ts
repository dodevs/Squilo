import type { Transaction } from "mssql";
import { Output } from "../output"
import type { DatabaseConnection } from "../connect/types";
import type { RetrieveChain } from "./types";
import { Presets, SingleBar } from "cli-progress";
import { CleanErrors, type ErrorType } from "../../utils/append-error";
import { TransactionRunner } from "../shared/transaction-runner";

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

        const runner = TransactionRunner();

        const executeFn = (dc: DatabaseConnection) => runner({
            connection: dc,
            input,
            fn,
            onSuccess: async (result) => {
                await writer.write({ [dc.database]: result });
            },
            onError: async (error) => {
                await writable.abort(error as ErrorType);
            },
            singleBar: singlerBar,
        });

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
import type { Transaction } from "mssql";
import { Output } from "../output"
import type { DatabaseConnection } from "../connect/types";
import type { RetrieveChain } from "./types";
import { Presets, SingleBar } from "cli-progress";

export const Retrieve = <TParam>(
    connections$: (databases: string[]) => Generator<DatabaseConnection[]>, 
    databases$: Promise<string[]>,
    input: TParam
) => {
    return <TReturn>(fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>): RetrieveChain<TReturn> => {
        const { readable, writable } = new TransformStream<Record<string, TReturn>, Record<string, TReturn>>();
        const writer = writable.getWriter();

        const singlerBar = new SingleBar({
            format: `{database} {bar} {percentage}% | {value}/{total}`
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
                // TODO: Append client name and error in a structured json file
                transaction.rollback();
            }
        };

        // Process all connections and close the stream when done
        (async () => {
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

            // Close the writer when all connections are processed
            await writer.close();
        })();

        return {
            Output: Output(readable)
        };
    }
}
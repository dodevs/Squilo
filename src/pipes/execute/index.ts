import type { Transaction } from 'mssql';
import type { DatabaseConnection } from "../connect/types";
import { Presets, SingleBar } from 'cli-progress';
import { AppendError, CleanErrors, type ErrorType } from '../../utils/append-error';
import { LoadEnv } from '../../utils/load-env';

const ENV = LoadEnv();
let ERRORS_COUNT = 0;


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
                await AppendError(dc.database, error as ErrorType);

                if (++ERRORS_COUNT > ENV.MAX_ERRORS) {
                    console.error('Max errors reached, exiting...');
                    process.exit(1);
                }
            }
        };

        await CleanErrors();
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
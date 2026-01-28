import type { Transaction } from 'mssql';
import type { DatabaseConnection } from "../connect/types";
import { Runner } from '../shared/runner';
import type { ExecutionError } from '../shared/runner/types';

export const Execute = <T>(
    connections$: (databases: T[]) => Generator<DatabaseConnection<T>[]>,
    databases$: Promise<T[]>
) => {
    return async (
        fn: (transaction: Transaction, database: T) => Promise<void>
    ): Promise<ExecutionError<T>[]> => {
        const errors: ExecutionError<T>[] = [];

        const [runner, singleBar] = Runner<T>();

        const executeFn = (dc: DatabaseConnection<T>) => runner({
            connection: dc,
            fn,
            onResult(_, error) {
                if (error) {
                    errors.push({
                        database: dc.database,
                        error
                    })
                }
            },
        });

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

        return errors;
    };
};
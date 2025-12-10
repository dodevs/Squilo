import type { Transaction } from 'mssql';
import type { DatabaseConnection } from "../connect/types";
import { TransactionRunner } from '../shared/transaction-runner';
import type { ExecutionError } from './types';

export const Execute = <TParam>(
    connections$: (databases: string[]) => Generator<DatabaseConnection[]>,
    databases$: Promise<string[]>,
    input: TParam
) => {
    return async (
        fn: (transaction: Transaction, database: string, params: TParam) => Promise<void>
    ): Promise<ExecutionError[]> => {
        const errors: ExecutionError[] = [];

        const [runner, singleBar] = TransactionRunner();

        const executeFn = (dc: DatabaseConnection) => runner({
            connection: dc,
            input,
            fn,
            onError: async (error) => {
                errors.push({
                    database: dc.database,
                    error: {
                        name: error.name,
                        message: error.message,
                        stack: error.stack,
                        code: (error as any).code || undefined,
                        number: (error as any).number || undefined,
                        state: (error as any).state || undefined,
                        class: (error as any).class || undefined,
                        serverName: (error as any).serverName || undefined,
                        procName: (error as any).procName || undefined,
                        lineNumber: (error as any).lineNumber || undefined
                    }
                });
            }
        });

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

        return errors;
    };
};
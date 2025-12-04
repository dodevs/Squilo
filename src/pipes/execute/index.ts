import type { Transaction } from 'mssql';
import type { DatabaseConnection } from "../connect/types";
import { Presets, SingleBar } from 'cli-progress';
import { CleanErrors } from '../../utils/append-error';
import { TransactionRunner } from '../shared/transaction-runner';

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

        const runner = TransactionRunner();

        const executeFn = (dc: DatabaseConnection) => runner({
            connection: dc,
            input,
            fn,
            singleBar: singlerBar,
        });

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
    };
};
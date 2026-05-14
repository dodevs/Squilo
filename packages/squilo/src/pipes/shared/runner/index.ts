import { Presets, SingleBar } from 'cli-progress';
import { LoadEnv } from '../../../utils/load-env';
import { type ErrorType, type RunnerOptions, type TransactionRunner, SafeGuardError } from './types';
import type { MSSQLError, RequestError } from 'mssql';
import type { DatabaseObject } from '../../connect/types';
import { ConnectionPoolWrapper } from '../../../pool';

export const Runner = <T extends string | DatabaseObject>(): [TransactionRunner<T>, SingleBar] => {

    const singleBar = new SingleBar({
        format: `{bar} {percentage}% | {value}/{total} | {database}`,
        hideCursor: true
    }, Presets.shades_classic);

    const [guard, trackError] = (() => { 
        const limit = LoadEnv().SAFE_GUARD;
        let errorsCount = 0, open = false;

        const guard = async () => {
            if (open) {
                throw new SafeGuardError();
            }
        }

        const trackError = () => {
            errorsCount++;
            if (limit > 0 && errorsCount >= limit) {
                open = true;
            }
        }

        return [guard, trackError];
    })()

    const runner = async <TReturn>({
        connection: dc,
        fn,
        onResult = () => { }
    }: RunnerOptions<T, TReturn>): Promise<void> => {
        const databaseName = typeof dc.database === 'string' ? dc.database : dc.database.Database;
        return guard()
            .then(() => {
                if (singleBar && Bun.env.NODE_ENV !== 'test') {
                    singleBar.update({ database: databaseName });
                }
            })
            .then(() => dc.connection())
            .then(async (conn) => {
                await using wrapped = new ConnectionPoolWrapper(conn);
                return await fn(wrapped, dc.database);
            })
            .then(result => onResult(result))
            .then(() => {
                if (singleBar && Bun.env.NODE_ENV !== 'test') {
                    singleBar.increment(1, { database: databaseName });
                }
            })
            .catch(error => {
                if (singleBar && Bun.env.NODE_ENV !== 'test') {
                    singleBar.increment(1, { database: databaseName });
                }

                if (error instanceof SafeGuardError) {
                    return;
                }

                trackError();
                onResult(undefined, ({
                    name: error.name,
                    message: error.message,
                    stack: error.stack,
                    code: (error as MSSQLError).code || undefined,
                    number: (error as RequestError).number || undefined,
                    state: (error as RequestError).state || undefined,
                    class: (error as RequestError).class || undefined,
                    serverName: (error as RequestError).serverName || undefined,
                    procName: (error as RequestError).procName || undefined,
                    lineNumber: (error as RequestError).lineNumber || undefined
                }) as ErrorType);
            });
    };

    return [runner, singleBar];
};

import type { ConnectionError, PreparedStatementError, RequestError, Transaction, TransactionError } from 'mssql';
import type { DatabaseConnection } from '../connect/types';
import { Presets, SingleBar } from 'cli-progress';
import { LoadEnv } from '../../utils/load-env';

export type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;

export interface TransactionRunnerOptions<TParam, TReturn> {
    connection: DatabaseConnection;
    input: TParam;
    fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>;
    onSuccess?: (result: TReturn) => Promise<void> | void;
    onError?: (error: ErrorType) => Promise<void> | void;
}

class SafeGuardError extends Error {
    constructor() {
        super(`Safe guard reached`);
    }
}

export const TransactionRunner = (): [typeof runner, typeof singleBar] => {
    const singleBar = new SingleBar({
        format: `{bar} {percentage}% | {value}/{total} | {database}`
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
            if (errorsCount >= limit) {
                open = true;
            }
        }

        return [guard, trackError];
    })()

    const runner = async <TParam, TReturn>({
        connection: dc,
        input,
        fn,
        onSuccess = () => { },
        onError = () => { }
    }: TransactionRunnerOptions<TParam, TReturn>): Promise<void> => {
        return guard()
            .then(() => {
                if (singleBar && Bun.env.NODE_ENV !== 'test') {
                    singleBar.update({ database: dc.database });
                }
            })
            .then(() => dc.connection)
            .then(opened => opened.transaction())
            .then(tran => tran.begin()
                .then(() => fn(tran, dc.database, input))
                .then(result => onSuccess(result))
                .then(() => tran.commit())
                .then(() => {
                    if (singleBar && Bun.env.NODE_ENV !== 'test') {
                        singleBar.increment(1, { database: dc.database });
                    }
                })
                .catch(error => tran.rollback().then(() => { throw error }))
            )
            .catch(async error => {
                if (error instanceof SafeGuardError) {
                    return;
                }

                trackError();
                onError(error as ErrorType);
            });
    };

    return [runner, singleBar];
};

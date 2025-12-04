import type { Transaction } from 'mssql';
import type { DatabaseConnection } from '../connect/types';
import { SingleBar } from 'cli-progress';
import { AppendError, type ErrorType } from '../../utils/append-error';
import { LoadEnv } from '../../utils/load-env';

export interface TransactionRunnerOptions<TParam, TReturn> {
    connection: DatabaseConnection;
    input: TParam;
    fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>;
    onSuccess?: (result: TReturn) => Promise<void> | void;
    onError?: (error: any) => Promise<void> | void;
    singleBar?: SingleBar;
}

export const TransactionRunner = () => {
    const ENV = LoadEnv();
    const limit = ENV.MAX_ERRORS;
    let errorsCount = 0;

    return async <TParam, TReturn>({
        connection: dc,
        input,
        fn,
        onSuccess,
        onError,
        singleBar,
    }: TransactionRunnerOptions<TParam, TReturn>): Promise<void> => {
        return dc.connection
            .then(opened => opened.transaction())
            .then(tran => tran.begin()
                .then(() => fn(tran, dc.database, input))
                .then(async (result) => {
                    if (onSuccess) {
                        await onSuccess(result);
                    }
                    return result;
                })
                .then(() => tran.commit())
                .then(() => {
                    if (singleBar && Bun.env.NODE_ENV !== 'test') {
                        singleBar.increment(1, { database: dc.database });
                    }
                })
                .catch(error => tran.rollback().then(() => { throw error }))
            )
            .catch(async error => {
                AppendError(dc.database, error as ErrorType);
                if (++errorsCount > limit) {
                    if (onError) {
                        await onError(error);
                    }
                    console.error('Max errors reached, exiting...');
                    process.exit(1);
                }
            });
    };
};

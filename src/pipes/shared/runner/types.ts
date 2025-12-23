import type { ConnectionError, TransactionError, RequestError, PreparedStatementError, Transaction } from "mssql";
import type { DatabaseConnection } from "../../connect/types";

export type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;

export interface RunnerOptions<TParam, TReturn> {
    connection: DatabaseConnection;
    input: TParam;
    fn: (transaction: Transaction, database: string, params: TParam) => Promise<TReturn>;
    onSuccess?: (result: TReturn) => Promise<void> | void;
    onError?: (error: ErrorType) => Promise<void> | void;
}

export type TransactionRunner = <TParam, TReturn>(options: RunnerOptions<TParam, TReturn>) => Promise<void>;

export type ExecutionError = Record<string, ErrorType>;

export class SafeGuardError extends Error {
    constructor() {
        super(`Safe guard reached`);
    }
}
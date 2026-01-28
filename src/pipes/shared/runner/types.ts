import type { ConnectionError, TransactionError, RequestError, PreparedStatementError, Transaction } from "mssql";
import type { DatabaseConnection } from "../../connect/types";

export type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;

export interface RunnerOptions<T, TReturn> {
    connection: DatabaseConnection<T>;
    fn: (transaction: Transaction, database: T) => Promise<TReturn>;
    onResult?: (data?: TReturn, error?: ErrorType) => Promise<void> | void
}

export type TransactionRunner<T> = <TReturn>(options: RunnerOptions<T, TReturn>) => Promise<void>;

export type Execution<T> = { database: T }
export type ExecutionError<T> = Execution<T> & { error: ErrorType };
export type ExecutionData<T, TReturn> = Execution<T> & { data: TReturn }
export type ExecutionResult<T, TReturn> = Execution<T> & Partial<ExecutionData<T, TReturn>> & Partial<ExecutionError<T>>

export class SafeGuardError extends Error {
    constructor() {
        super(`Safe guard reached`);
    }
}
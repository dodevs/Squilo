import type { Duration } from "effect";
import type { RetrieveChain } from "../retrieve/types";
import type { ErrorType, ExecutionError } from "../shared/runner/types";
import type { ConnectionPoolWrapper } from "../../pool";

/** Milliseconds, or a string such as `"30 seconds"` / `"2 minutes"`. */
export type DurationInput = Duration.Input;

export type RetryOptions = {
    /** Retries after the first attempt. */
    times: number;
    /** Base delay of the exponential backoff. Default: `"200 millis"`. */
    delay?: DurationInput;
    /** Which errors to retry. Default: `IsTransientError` (deadlock, throttling, dropped connection). */
    while?: (error: ErrorType) => boolean;
}

export type ExecutionOptions = {
    /** How many databases run at once (sliding window). Default: all at once. */
    concurrent?: number;
    /** Re-runs a database's callback, on a fresh connection, when it fails with a retryable error. */
    retry?: number | RetryOptions;
    /**
     * Time budget per database, retries included. On expiry the connection is closed at the socket level,
     * which aborts the running query and makes SQL Server roll back its open transaction.
     */
    timeout?: DurationInput;
    /** Aborting stops databases that have not started and closes the in-flight ones like `timeout` does. */
    signal?: AbortSignal;
}

export type DatabaseObject = object & {
    Database: string;
}

export type ConnectionOptions = {
    database: string;
    query: `SELECT ${string}[Database]${string} FROM ${string}`;
}

export type ConnectionChain<T> = {
    Execute(fn: (connection: ConnectionPoolWrapper, database: T) => Promise<void>): Promise<ExecutionError<T>[]>;
    Retrieve<TResult>(fn: (connection: ConnectionPoolWrapper, database: T) => Promise<TResult>): RetrieveChain<T, TResult>;
}
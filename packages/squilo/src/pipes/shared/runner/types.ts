import type { ConnectionError, TransactionError, RequestError, PreparedStatementError } from "mssql";
import type { Effect, Stream } from "effect";
import type { ConnectionPoolWrapper } from "../../../pool";

export type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;

export type Execution<T> = { database: T }
export type ExecutionError<T> = Execution<T> & { error: ErrorType };
export type ExecutionData<T, TReturn> = Execution<T> & { data: TReturn }
export type ExecutionResult<T, TReturn> = Execution<T> & Partial<ExecutionData<T, TReturn>> & Partial<ExecutionError<T>>

export type RunnerFn<T, TReturn> = (connection: ConnectionPoolWrapper, database: T) => Promise<TReturn>;

export type RunStream<T> = <TReturn>(fn: RunnerFn<T, TReturn>) => Stream.Stream<ExecutionResult<T, TReturn>, unknown>;

export type Databases<T> = Effect.Effect<T[], unknown>;

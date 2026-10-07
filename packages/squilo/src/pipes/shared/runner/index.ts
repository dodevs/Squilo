import { Effect, Result, Schedule, Stream } from "effect";
import type { MSSQLError, RequestError } from "mssql";
import { ConnectionPoolWrapper, ForceClose, HasBusyConnections, type Pool } from "../../../pool";
import { LoadEnv } from "../../../utils/load-env";
import type { DatabaseObject, ExecutionOptions, RetryOptions } from "../../connect/types";
import { Progress } from "../progress";
import { IsTransientError } from "./transient";
import type { Databases, ErrorType, ExecutionResult, RunnerFn, RunStream } from "./types";

const nameOf = (database: string | DatabaseObject): string =>
    typeof database === "string" ? database : database.Database;

const namedError = (name: string, message: string): Error => Object.assign(new Error(message), { name });

const toErrorType = (cause: unknown): ErrorType => {
    const error = cause as MSSQLError & RequestError;
    return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code || undefined,
        number: error.number || undefined,
        state: error.state || undefined,
        class: error.class || undefined,
        serverName: error.serverName || undefined,
        procName: error.procName || undefined,
        lineNumber: error.lineNumber || undefined
    } as ErrorType;
};

const withRetry = <A>(execution: Effect.Effect<A, unknown>, retry: number | RetryOptions): Effect.Effect<A, unknown> => {
    const { times, delay = "200 millis", while: shouldRetry = IsTransientError } =
        typeof retry === "number" ? { times: retry } : retry;

    return Effect.retry(execution, {
        times,
        schedule: Schedule.exponential(delay),
        while: (error: unknown) => shouldRetry(error as ErrorType),
    });
};

const abortion = (signal: AbortSignal) => Effect.callback<never, Error>((resume) => {
    const onAbort = () => resume(Effect.fail(namedError("AbortError", "Execution aborted")));

    if (signal.aborted) {
        return onAbort();
    }

    signal.addEventListener("abort", onAbort, { once: true });
    return Effect.sync(() => signal.removeEventListener("abort", onAbort));
});

export const Runner = <T extends string | DatabaseObject>(
    pool: Pool,
    databases$: Databases<T>,
    { concurrent, retry, timeout, signal }: ExecutionOptions = {}
): RunStream<T> => <TReturn>(fn: RunnerFn<T, TReturn>) => Stream.unwrap(Effect.gen(function* () {
    const databases = yield* databases$;
    const safeGuard = LoadEnv().SAFE_GUARD;
    const progress = Progress();
    let errorsCount = 0;

    const tripped = () => (safeGuard > 0 && errorsCount >= safeGuard) || signal?.aborted === true;

    const connection = (database: T) => Effect.acquireRelease(
        Effect.tryPromise({
            try: () => pool.connect({ database: nameOf(database) })(),
            catch: (cause) => cause,
        }).pipe(Effect.map((conn) => new ConnectionPoolWrapper(conn))),
        (conn) => HasBusyConnections(conn)
            ? Effect.sync(() => ForceClose(conn))
            : Effect.promise(() => conn.close().catch(() => { })),
    );

    const attempt = (database: T): Effect.Effect<TReturn, unknown> => Effect.scoped(Effect.gen(function* () {
        const conn = yield* connection(database);
        const result = yield* Effect.tryPromise({
            try: () => fn(conn, database),
            catch: (cause) => cause,
        });

        if (HasBusyConnections(conn)) {
            return yield* Effect.fail(namedError(
                "UnfinishedWorkError",
                "The callback returned while a connection was still in use (an open transaction or an un-awaited query). " +
                "The connection was closed and SQL Server rolled back any open transaction."
            ));
        }

        return result;
    }));

    const execute = (database: T): Effect.Effect<TReturn, unknown> => {
        let execution = attempt(database);

        if (retry !== undefined) {
            execution = withRetry(execution, retry);
        }

        if (timeout !== undefined) {
            execution = execution.pipe(Effect.timeoutOrElse({
                duration: timeout,
                orElse: () => Effect.fail(namedError(
                    "TimeoutError",
                    `Execution timed out after ${typeof timeout === "number" ? `${timeout}ms` : timeout}`
                )),
            }));
        }

        if (signal !== undefined) {
            execution = execution.pipe(Effect.raceFirst(abortion(signal)));
        }

        return execution;
    };

    const run = (database: T): Effect.Effect<ExecutionResult<T, TReturn> | undefined> => Effect.suspend(() => {
        const name = nameOf(database);

        if (tripped()) {
            progress.increment(name);
            return Effect.succeed(undefined);
        }

        progress.update(name);
        return execute(database).pipe(
            Effect.result,
            Effect.map((result) => {
                progress.increment(name);

                if (Result.isSuccess(result)) {
                    return { database, data: result.success, error: undefined };
                }

                errorsCount++;
                return { database, data: undefined, error: toErrorType(result.failure) };
            }),
        );
    });

    const warmup = Math.max(0, Math.min(databases.length, concurrent ?? databases.length, safeGuard || 0));

    return Stream.concat(
        Stream.fromIterable(databases.slice(0, warmup)).pipe(Stream.mapEffect(run)),
        Stream.fromIterable(databases.slice(warmup)).pipe(
            Stream.mapEffect(run, { concurrency: concurrent ?? "unbounded", unordered: true }),
        ),
    ).pipe(
        Stream.filter((result): result is ExecutionResult<T, TReturn> => result !== undefined),
        Stream.onStart(Effect.sync(() => progress.start(databases.length))),
        Stream.ensuring(Effect.sync(() => progress.stop())),
    );
}));

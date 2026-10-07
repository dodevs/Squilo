import { Duration, Effect, Option, Result, Schedule, Stream } from "effect";
import type { MSSQLError, RequestError } from "mssql";
import { ConnectionPoolWrapper, ForceClose, HasBusyConnections, type Pool } from "../../../pool";
import { LoadEnv } from "../../../utils/load-env";
import type { DatabaseObject, DurationInput, ExecutionOptions, RetryOptions } from "../../connect/types";
import { Progress } from "../progress";
import { IsTransientError } from "./transient";
import {
    Aborted,
    ConnectionFailed,
    ExecutionFailed,
    type Databases,
    type ErrorType,
    type ExecutionResult,
    type RunnerError,
    type RunnerFn,
    type RunStream,
    TimedOut,
    UnfinishedWork,
} from "./types";

const nameOf = (database: string | DatabaseObject): string =>
    typeof database === "string" ? database : database.Database;

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

const formatDuration = (input: DurationInput): string =>
    Option.getOrElse(Option.map(Duration.fromInput(input), Duration.format), () => String(input));

const withRetry = <A>(execution: Effect.Effect<A, RunnerError>, retry: number | RetryOptions): Effect.Effect<A, RunnerError> => {
    const { times, delay = "200 millis", while: shouldRetry = IsTransientError } =
        typeof retry === "number" ? { times: retry } : retry;

    return Effect.retry(execution, {
        times,
        schedule: Schedule.exponential(delay),
        while: (error: RunnerError) => shouldRetry(error.cause as ErrorType),
    });
};

// mssql defers some connection releases (e.g. after the server aborts a transaction) with setImmediate.
const settle = Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));

/** Fails with `Aborted` as soon as the signal aborts. */
const abortion = (signal: AbortSignal) => Effect.callback<never, Aborted>((resume) => {
    const onAbort = () => resume(Effect.fail(new Aborted()));

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
            catch: (cause) => new ConnectionFailed(cause),
        }).pipe(Effect.map((conn) => new ConnectionPoolWrapper(conn))),
        // A connection still busy here (interrupted by timeout/abort, or a transaction left open) would make
        // `close()` wait forever.
        (conn) => settle.pipe(Effect.andThen(Effect.suspend(() => HasBusyConnections(conn)
            ? Effect.sync(() => ForceClose(conn))
            : Effect.promise(() => conn.close().catch(() => { }))
        ))),
    );

    const attempt = (database: T): Effect.Effect<TReturn, RunnerError> => Effect.scoped(Effect.gen(function* () {
        const conn = yield* connection(database);
        const result = yield* Effect.tryPromise({
            try: () => fn(conn, database),
            catch: (cause) => new ExecutionFailed(cause),
        });

        // The callback returned but left work behind (e.g. `const tx` instead of `await using tx`): its
        // transaction is about to be rolled back, so this database must not be reported as a success.
        yield* settle;
        if (HasBusyConnections(conn)) {
            return yield* Effect.fail(new UnfinishedWork());
        }

        return result;
    }));

    const execute = (database: T): Effect.Effect<TReturn, RunnerError> => {
        let execution = attempt(database);

        if (retry !== undefined) {
            execution = withRetry(execution, retry);
        }

        if (timeout !== undefined) {
            execution = execution.pipe(Effect.timeoutOrElse({
                duration: timeout,
                orElse: () => Effect.fail(new TimedOut(formatDuration(timeout))),
            }));
        }

        if (signal !== undefined) {
            execution = execution.pipe(Effect.raceFirst(abortion(signal)));
        }

        return execution;
    };

    // Once SAFE_GUARD errors are reached, or the signal aborts, pending databases are skipped (nothing is
    // emitted for them). SAFE_GUARD does not interrupt in-flight executions; aborting does.
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
                return { database, data: undefined, error: toErrorType(result.failure.cause) };
            }),
        );
    });

    // The first SAFE_GUARD databases run one at a time, so a systematic failure halts
    // the run before fanning out. The rest run in a sliding window of `concurrent`.
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

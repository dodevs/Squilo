import { Effect, Result, Stream } from "effect";
import type { MSSQLError, RequestError } from "mssql";
import { ConnectionPoolWrapper, type Pool } from "../../../pool";
import { LoadEnv } from "../../../utils/load-env";
import type { DatabaseObject } from "../../connect/types";
import { Progress } from "../progress";
import {
    ConnectionFailed,
    ExecutionFailed,
    type Databases,
    type ErrorType,
    type ExecutionResult,
    type RunnerError,
    type RunnerFn,
    type RunStream,
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

export const Runner = <T extends string | DatabaseObject>(
    pool: Pool,
    databases$: Databases<T>,
    concurrent?: number
): RunStream<T> => <TReturn>(fn: RunnerFn<T, TReturn>) => Stream.unwrap(Effect.gen(function* () {
    const databases = yield* databases$;
    const safeGuard = LoadEnv().SAFE_GUARD;
    const progress = Progress();
    let errorsCount = 0;

    const tripped = () => safeGuard > 0 && errorsCount >= safeGuard;

    const connection = (database: T) => Effect.acquireRelease(
        Effect.tryPromise({
            try: () => pool.connect({ database: nameOf(database) })(),
            catch: (cause) => new ConnectionFailed(cause),
        }).pipe(Effect.map((conn) => new ConnectionPoolWrapper(conn))),
        (conn) => Effect.promise(() => conn.close().catch(() => { })),
    );

    const execute = (database: T): Effect.Effect<TReturn, RunnerError> => connection(database).pipe(
        Effect.flatMap((conn) => Effect.tryPromise({
            try: () => fn(conn, database),
            catch: (cause) => new ExecutionFailed(cause),
        })),
        Effect.scoped,
    );

    // Once SAFE_GUARD errors are reached, pending databases are skipped (nothing is emitted for them).
    // In-flight executions are not interrupted.
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

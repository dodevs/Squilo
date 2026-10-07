import { Effect, Stream } from "effect";
import type { DatabaseObject } from "../connect/types";
import type { ExecutionError, RunnerFn, RunStream } from "../shared/runner/types";

export const Execute = <T extends string | DatabaseObject>(run: RunStream<T>) =>
    (fn: RunnerFn<T, void>): Promise<ExecutionError<T>[]> => run(fn).pipe(
        Stream.runCollect,
        Effect.map((results) => results.flatMap(({ database, error }) => error ? [{ database, error }] : [])),
        Effect.runPromise,
    );

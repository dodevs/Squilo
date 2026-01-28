import type { ExecutionResult } from "../../shared/runner/types";

export type OutputStrategy<T, TReturn, TOutput = void> = (data: ReadableStream<ExecutionResult<T, TReturn>>) => Promise<TOutput>;

import type { ExecutionData } from "../../shared/runner/types";

export type OutputStrategy<TReturn, TOutput = void> = (data: ReadableStream<ExecutionData<TReturn>>) => Promise<TOutput>;

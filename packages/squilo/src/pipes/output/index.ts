import type { ExecutionResult } from "../shared/runner/types";
import type { OutputStrategy } from "./strategies/types";

export const Output =
    <T, TReturn, TOutput = void>(
        result: ReadableStream<ExecutionResult<T, TReturn >>,
    ) =>
        async (strategy: OutputStrategy<T, TReturn, TOutput>): Promise<TOutput> => await strategy(result);

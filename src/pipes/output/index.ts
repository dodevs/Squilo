import type { ExecutionData, ExecutionError } from "../shared/runner/types";
import type { OutputStrategy } from "./strategies/types";

export const Output =
    <TReturn, TOutput = void>(
        data: ReadableStream<ExecutionData<TReturn >>,
        error: ReadableStream<ExecutionError>
    ) =>
        async (strategy: OutputStrategy<TReturn, TOutput>): Promise<[ExecutionError[], TOutput]> => {
            const errors: ExecutionError[] = [];
            const output = await strategy(data);
            for await (const item of error) {
                errors.push(item);
            }
            return [errors, output];
        };

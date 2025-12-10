import type { ExecutionError } from "../execute/types";
import type { OutputStrategy } from "./types";

export const Output =
    <TReturn, TOutput = void>(
        data: ReadableStream<Record<string, TReturn>>,
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

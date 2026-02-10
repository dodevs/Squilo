import type { ExecutionResult } from "../shared/runner/types";
import type { TransformChain, TransformFunction } from "./types";
import { Output } from "../output";

export const Transform = <T, TInput>(
    result: ReadableStream<ExecutionResult<T, TInput>>
) => {
    return <TOutput>(transformFn: TransformFunction<TInput, TOutput>): TransformChain<T, TOutput> => {
        class TransformDataStream extends TransformStream<ExecutionResult<T, TInput>, ExecutionResult<T, TOutput>> {
            constructor() {
                super({
                    async transform(chunk, controller) {
                        const transformedData: ExecutionResult<T, TOutput> = {
                            database: chunk.database,
                            data: chunk.data ? await transformFn(chunk.data) : undefined,
                            error: chunk.error,
                        };
                        controller.enqueue(transformedData);
                    }
                })
            }
        }
        
        const transformedData = result.pipeThrough(new TransformDataStream());

        return {
            Output: Output(transformedData)
        };
    }
}
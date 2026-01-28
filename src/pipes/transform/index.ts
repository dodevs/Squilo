import type { ExecutionData, ExecutionResult } from "../shared/runner/types";
import type { TransformChain, TransformFunction } from "./types";
import { Output } from "../output";

export const Transform = <T, TInput>(
    result: ReadableStream<ExecutionResult<T, TInput>>
) => {
    return <TOutput>(transformFn: TransformFunction<TInput, TOutput>): TransformChain<T, TOutput> => {
        class TransformDataStream extends TransformStream<ExecutionData<T, TInput>, ExecutionData<T, TOutput>> {
            constructor() {
                super({
                    async transform(chunk, controller) {
                        const transformedData: ExecutionData<T, TOutput> = {
                            database: chunk.database,
                            data: await transformFn(chunk.data)
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
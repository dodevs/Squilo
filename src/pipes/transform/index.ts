import type { ExecutionData, ExecutionError } from "../shared/runner/types";
import type { TransformChain, TransformFunction } from "./types";
import { Output } from "../output";

export const Transform = <TInput>(
    data: ReadableStream<ExecutionData<TInput>>,
    error: ReadableStream<ExecutionError>
) => {
    return <TOutput>(transformFn: TransformFunction<TInput, TOutput>): TransformChain<TInput, TOutput> => {
        class TransformDataStream extends TransformStream<ExecutionData<TInput>, ExecutionData<TOutput>> {
            constructor() {
                super({
                    async transform(chunk, controller) {
                        const transformedData: ExecutionData<TOutput> = {
                            database: chunk.database,
                            data: await transformFn(chunk.data)
                        };
                        controller.enqueue(transformedData);
                    }
                })
            }
        }
        
        const transformedData = data.pipeThrough(new TransformDataStream());

        return {
            Output: Output(transformedData, error)
        };
    }
}
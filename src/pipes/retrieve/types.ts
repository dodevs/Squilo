import type { OutputStrategy } from "../output/strategies/types";
import type { ExecutionError } from "../shared/runner/types";
import type { TransformChain, TransformFunction } from "../transform/types";

export type RetrieveChain<TReturn> = {
    Transform<TOutput>(transformFn: TransformFunction<TReturn, TOutput>): TransformChain<TReturn, TOutput>;
    Output<TOutput>(strategy: OutputStrategy<TReturn, TOutput>): Promise<[ExecutionError[], TOutput]>;
}
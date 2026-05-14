import type { OutputStrategy } from "../output/strategies/types";
import type { TransformChain, TransformFunction } from "../transform/types";

export type RetrieveChain<T, TReturn> = {
    Transform<TOutput>(transformFn: TransformFunction<TReturn, TOutput>): TransformChain<T, TOutput>;
    Output<TOutput>(strategy: OutputStrategy<T, TReturn, TOutput>): Promise<TOutput>;
}
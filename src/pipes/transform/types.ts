import type { OutputStrategy } from "../output/strategies/types";

export type TransformChain<T, TOutput> = {
    Output<TFinalOutput>(strategy: OutputStrategy<T, TOutput, TFinalOutput>): Promise<TFinalOutput>;
};

export type TransformFunction<TInput, TOutput> = (data: TInput) => TOutput | Promise<TOutput>;
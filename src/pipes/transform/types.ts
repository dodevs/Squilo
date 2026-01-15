import type { OutputStrategy } from "../output/strategies/types";
import type { ExecutionError } from "../shared/runner/types";

export type TransformChain<TInput, TOutput> = {
    Output<TFinalOutput>(strategy: OutputStrategy<TOutput, TFinalOutput>): Promise<[ExecutionError[], TFinalOutput]>;
};

export type TransformFunction<TInput, TOutput> = (data: TInput) => TOutput | Promise<TOutput>;
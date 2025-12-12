import type { OutputStrategy } from "../output/strategies/types";
import type { ExecutionError } from "../execute/types";

export type RetrieveChain<TReturn> = {
    Output<TOutput>(strategy: OutputStrategy<TReturn, TOutput>): Promise<[ExecutionError[], TOutput]>;
}
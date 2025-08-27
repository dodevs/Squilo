import type { OutputStrategy } from "../output/types";

export type RetrieveChain<TReturn> = {
    Output<TOutput>(strategy: OutputStrategy<TReturn, TOutput>): Promise<TOutput>;
}
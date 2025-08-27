import type { OutputStrategy } from "./types";

export const Output = 
    <TReturn, TOutput = void>(data: ReadableStream<Record<string, TReturn>>) => 
    (strategy: OutputStrategy<TReturn, TOutput>): Promise<TOutput> => strategy(data);

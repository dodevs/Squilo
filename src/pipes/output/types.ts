export type OutputStrategy<TReturn, TOutput = void> = (data: ReadableStream<Record<string, TReturn>>) => Promise<TOutput>;

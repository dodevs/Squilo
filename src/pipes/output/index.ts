export type OutputStrategy<TReturn, TOutput = void> = (data: ReadableStream<Record<string, TReturn>>) => Promise<TOutput>;

export const Output = <TReturn, TOutput = void>(data: ReadableStream<Record<string, TReturn>>) => (strategy: OutputStrategy<TReturn, TOutput>): Promise<TOutput> => strategy(data);


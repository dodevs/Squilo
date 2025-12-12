import type { OutputStrategy } from './types';

export const ConsoleOutputStrategy = <TData>(): OutputStrategy<TData, void> => async (result) => {
  for await (const data of result) {
    console.log(data);
  }
};
import type { OutputStrategy } from './types';

export const ConsoleOutputStrategy = <T, TData>(): OutputStrategy<T, TData, void> => async (result) => {
  for await (const data of result) {
    console.log(data);
  }
};
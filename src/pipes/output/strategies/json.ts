import type { OutputStrategy } from '../index';

export const JsonOutputStrategy = <TData>(): OutputStrategy<TData, Record<string, TData[]>> => async (result) => {
  const data: Record<string, TData[]> = {};
  for await (const item of result) {
    Object.assign(data, item);
  }
  return data;
};
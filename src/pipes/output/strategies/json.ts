import type { OutputStrategy } from '../index';

export const JsonOutputStrategy = <TData>(): OutputStrategy<TData, string> => async (result) => {
  const data: Record<string, TData> = {};
  for await (const item of result) {
    Object.assign(data, item);
  }
  return JSON.stringify(data, null, 2);
};
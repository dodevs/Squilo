import type { OutputStrategy } from '../types';

export const MergeOutputStrategy = <TData extends Array<unknown>, TMerged = TData extends Array<infer TItem> ? TItem : TData>(): OutputStrategy<TData, TMerged[]> => async (result) => {
  const data: TMerged[] = [];
  for await (const item of result) {
    Object.values(item).forEach((value) => {
      data.push(...value as TMerged[]);
    });
  }
  return data;
};
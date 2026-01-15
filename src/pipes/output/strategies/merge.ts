import type { OutputStrategy } from './types';

export const MergeOutputStrategy = <TData, TMerged = TData extends Array<infer TItem> ? TItem : TData>(): OutputStrategy<TData, TMerged[]> => async (result) => {
  const data: TMerged[] = [];
  for await (const item of result) {
    if (Array.isArray(item.data)) {
      data.push(...item.data);
    } else {
      data.push(item.data as unknown as TMerged);
    }
  }
  return data;
};
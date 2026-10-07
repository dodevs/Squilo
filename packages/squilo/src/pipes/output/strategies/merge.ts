import type { ExecutionError } from '../../shared/runner/types';
import type { OutputStrategy } from './types';

export const MergeOutputStrategy = <T, TData, TMerged = TData extends Array<infer TItem> ? TItem : TData>(): OutputStrategy<T, TData, [ExecutionError<T>[], TMerged[]]> => async (result) => {
  const data: TMerged[] = [];
  const errors: ExecutionError<T>[] = [];

  for await (const item of result) {
    if (item.error) {
      errors.push({ database: item.database, error: item.error });
      continue;
    }
    if (Array.isArray(item.data)) {
      data.push(...item.data);
    } else {
      data.push(item.data as unknown as TMerged);
    }
  }
  return [errors, data];
};
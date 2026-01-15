import type { ExecutionData } from '../../shared/runner/types';
import type { OutputStrategy } from './types';

const checkEmpty = (item: ExecutionData<unknown>) => {
  const value = item.data;
  if (value instanceof Array) {
    return value.length === 0;
  }

  if (value instanceof Object) {
    return Object.values(value).length === 0;
  }

  return value === null || value === undefined;
}

export const JsonOutputStrategy = <TData>(allowEmpty: boolean = true): OutputStrategy<TData, string> => async (result) => {
  const data: Record<string, TData> = {};

  for await (const item of result) {
    if (!allowEmpty && checkEmpty(item)) {
      continue;
    }
    data[item.database] = item.data;
  }

  let filename = process.argv[1]?.replace(/\.(?:js|ts)/, '')
  filename = `${filename}-${Date.now()}.json`;

  try {
    await Bun.write(filename, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing JSON file:', error);
  }

  return filename;
};
import type { OutputStrategy } from './types';

export const JsonOutputStrategy = <TData>(): OutputStrategy<TData, string> => async (result) => {
  const data: Record<string, TData[]> = {};

  for await (const item of result) {
    Object.assign(data, item);
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
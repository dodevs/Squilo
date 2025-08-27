import type { OutputStrategy } from '../types';

export const JsonOutputStrategy = <TData>(filename: string): OutputStrategy<TData, string> => async (result) => {
  const data: Record<string, TData[]> = {};
  
  for await (const item of result) {
    Object.assign(data, item);
  }

  filename = filename.replace(/\.json$/i, '');
  filename = filename.replace(/\s+/g, '_');
  filename = filename.replace(/[^\w\s-]/g, '');
  filename = `${filename}-${new Date().toISOString()}.json`;

  try {
    await Bun.write(filename, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('Error writing JSON file:', error);
  }

  return filename;
};
import type { ExecutionError, ExecutionResult } from '../../shared/runner/types';
import type { OutputStrategy } from './types';

const checkEmpty = <T, TData>({ data }: ExecutionResult<T, TData>) =>
  (data === undefined || data === null) || (typeof data === 'object' && Object.keys(data).length === 0);

function GetProcessingStream<T, TData>(includeEmpty: boolean, includeErrors: boolean, errors: ExecutionError<T>[]) {
  return class DataProcessingStream extends TransformStream<ExecutionResult<T, TData>, ExecutionResult<T, TData>> {
    constructor() {
      super({
        async transform(chunk, controller) {
          if (!includeErrors && chunk.error) {
            errors.push({ database: chunk.database, error: chunk.error});
            return;
          }

          if (!includeEmpty && checkEmpty(chunk)) {
            return;
          }

          controller.enqueue(chunk);
        },
      });
    }
  }
}

export function JsonOutputStrategy<T, TData>(): OutputStrategy<T, TData, [ExecutionError<T>[], string]>;
export function JsonOutputStrategy<T, TData>(includeEmpty: boolean): OutputStrategy<T, TData, [ExecutionError<T>[], string]>;
export function JsonOutputStrategy<T, TData>(includeEmpty: boolean, includeErrors: false): OutputStrategy<T, TData, [ExecutionError<T>[], string]>;
export function JsonOutputStrategy<T, TData>(includeEmpty: boolean, includeErrors: true): OutputStrategy<T, TData, string>;
export function JsonOutputStrategy<T, TData>(includeEmpty: boolean, includeErrors: boolean): OutputStrategy<T, TData, string | [ExecutionError<T>[], string]>;
export function JsonOutputStrategy<T, TData>(includeEmpty = true, includeErrors = false): OutputStrategy<T, TData, string | [ExecutionError<T>[], string]> {
  return async (result) => {
    const errors: ExecutionError<T>[] = [];

    let filename = process.argv[1]?.replace(/\.(?:js|ts)/, '')
    filename = `${filename}-${Date.now()}.json`;

    class DataProcessingStream extends GetProcessingStream<T, TData>(includeEmpty, includeErrors, errors) {}

    try {
      const file = Bun.file(filename);
      const writer = file.writer();

      writer.write('[');
      let first = true;
      for await (const chunk of result.pipeThrough(new DataProcessingStream())) {
        if (!first) {
          writer.write(',\n');
        }
        writer.write(`${JSON.stringify(chunk)}`);
        first = false;
      }
      writer.write(']');
      writer.end();
    } catch (error) {
      console.error('Error writing JSON file:', error);
    }

    if (!includeErrors) {
      return [errors, filename];
    }

    return  filename;
  }
}
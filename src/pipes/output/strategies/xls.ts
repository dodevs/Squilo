import * as XLSX from 'xlsx';
import type { OutputStrategy } from './types';
import type { ErrorType, ExecutionError, ExecutionResult } from '../../shared/runner/types';
import type { DatabaseObject } from '../../connect/types';

const checkEmpty = <T, TData>({ data }: ExecutionResult<T, TData>) =>
  (data === undefined || data === null) || (typeof data === 'object' && Object.keys(data).length === 0);

async function processSeparateSheets<T extends string | DatabaseObject, TData>(
  result: ReadableStream<ExecutionResult<T, TData>>,
  workbook: XLSX.WorkBook,
  includeEmpty = true
): Promise<ExecutionError<T>[]> {
  const errors: ExecutionError<T>[] = [];

  for await (const dbResult of result) {
    const database = dbResult.database;
    const data = dbResult.data;
    const error = dbResult.error;

    const databaseName = typeof database === 'string' ? database : database?.Database;

    if (error) {
      errors.push({database, error});
      continue;
    }

    if (checkEmpty(dbResult)) {
      if (includeEmpty) {
        const emptyWorksheet = XLSX.utils.json_to_sheet([{ database: databaseName, message: "No data available" }]);
        XLSX.utils.book_append_sheet(workbook, emptyWorksheet, databaseName);
      }
      continue;
    }

    let sheetData: unknown[] = [];
    if (Array.isArray(data)) {
      sheetData = data;
    } else if (data && typeof data === 'object') {
      sheetData = [data];
    } else {
      sheetData = [{ value: data }];
    }

    const worksheet = XLSX.utils.json_to_sheet(sheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, databaseName);
  }

  return errors;
}

async function processCombinedSheet<T extends string | DatabaseObject, TData>(
  result: ReadableStream<ExecutionResult<T, TData>>,
  workbook: XLSX.WorkBook,
  includeEmpty = true
): Promise<ExecutionError<T>[]> {
  const allData: unknown[] = [];
  const errors: ExecutionError<T>[] = [];

  const databaseGroups: { [database: string]: { startRow: number, endRow: number } } = {};
  let currentRow = 1; // Start from row 1 (header is row 0)

  for await (const dbResult of result) {
    const database = dbResult.database;
    const data = dbResult.data;
    const error = dbResult.error;

    const databaseName = typeof database === 'string' ? database : database?.Database;

    if (error) {
      errors.push({database, error});
      continue;
    }

    if (checkEmpty(dbResult)) {
      if (includeEmpty) {
        allData.push({ database });
      }
      continue;
    }

    let sheetData: unknown[] = [];
    if (Array.isArray(data)) {
      sheetData = data.map(item => ({ database: databaseName, ...item }));
    } else if (data && typeof data === 'object') {
      sheetData = [{ database: databaseName, ...data }];
    } else {
      sheetData = [{ database: databaseName, value: data }];
    }

    // Track the start row for this database group
    databaseGroups[databaseName] ??= { startRow: currentRow, endRow: currentRow };

    // Update the end row for this database group
    databaseGroups[databaseName].endRow = currentRow + sheetData.length - 1;
    currentRow += sheetData.length;

    allData.push(...sheetData);
  }

  const worksheet = XLSX.utils.json_to_sheet(allData);

  worksheet['!rows'] ??= [];

  // Set row grouping for each database
  for (const [_, { startRow, endRow }] of Object.entries(databaseGroups)) {
    // Set level 1 for all rows in this database group
    for (let i = startRow; i <= endRow; i++) {
      worksheet['!rows'][i] ??= { hpx: 20 };
      worksheet['!rows'][i]!.level = i === endRow ? 0 : 1;
    }
  }

  XLSX.utils.book_append_sheet(workbook, worksheet, "Combined");
  return errors;
}

function flattenErrors<T extends string | DatabaseObject>(errors: ExecutionError<T>[]): ({ database: string } & ErrorType)[] {
  return errors.map(error => {
    const databaseName = typeof error.database === 'string' ? error.database : error.database?.Database;
    return { database: databaseName, ...error.error };
  })
}

export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(): OutputStrategy<T, TData, [ExecutionError<T>[], string]>
export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(combineSheets: boolean): OutputStrategy<T, TData, [ExecutionError<T>[], string]>
export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(combineSheets: boolean, includeEmpty: boolean): OutputStrategy<T, TData, [ExecutionError<T>[], string]>
export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(combineSheets: boolean, includeEmpty: boolean, includeErrors: false): OutputStrategy<T, TData, [ExecutionError<T>[], string]>
export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(combineSheets: boolean, includeEmpty: boolean, includeErrors: true): OutputStrategy<T, TData, string>
export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(combineSheets: boolean, includeEmpty: boolean, includeErrors: boolean): OutputStrategy<T, TData, string | [ExecutionError<T>[], string]>
export function XlsOutputStrategy<T extends string | DatabaseObject, TData>(combineSheets = false, includeEmpty = true, includeErrors = false): OutputStrategy<T, TData, string | [ExecutionError<T>[], string]> {
  return async (result: ReadableStream<ExecutionResult<T, TData>>): Promise<string | [ExecutionError<T>[], string]> => {
    const workbook = XLSX.utils.book_new();
    let errors: ExecutionError<T>[] = [];

    if (combineSheets) {
      errors = await processCombinedSheet(result, workbook, includeEmpty);
    } else {
      errors = await processSeparateSheets(result, workbook, includeEmpty);
    }

    if (includeErrors) {
      const errorWorksheet = XLSX.utils.json_to_sheet(flattenErrors(errors));
      XLSX.utils.book_append_sheet(workbook, errorWorksheet, "Errors")
    }

    let filename = process.argv[1]?.replace(/\.(?:js|ts)/, '');
    filename = `${filename}-${Date.now()}.xlsx`;

    try {
      if (workbook.SheetNames.length) {
        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
        await Bun.write(filename, buffer);
      }

      if (!includeErrors) {
        return [errors, filename];
      }
      return filename;
    } catch (error) {
      console.error('Error writing Excel file');
      throw error;
    }
  };
}
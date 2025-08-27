import * as XLSX from 'xlsx';
import type { OutputStrategy } from '../types';

async function processSeparateSheets<TData>(
  result: ReadableStream<Record<string, TData>>,
  workbook: XLSX.WorkBook
): Promise<boolean> {
  let hasData = false;
  
  for await (const dbResult of result) {
    for (const [database, data] of Object.entries(dbResult)) {
      let sheetData: unknown[] = [];
      if (Array.isArray(data)) {
        sheetData = data;
      } else if (data && typeof data === 'object') {
        sheetData = [data];
      } else {
        sheetData = [{ value: data }];
      }
      
      if (sheetData.length > 0) {
        const worksheet = XLSX.utils.json_to_sheet(sheetData);
        XLSX.utils.book_append_sheet(workbook, worksheet, database);
        hasData = true;
      }
    }
  }
  
  return hasData;
}

async function processCombinedSheet<TData>(
  result: ReadableStream<Record<string, TData>>,
  workbook: XLSX.WorkBook
): Promise<boolean> {
  const allData: unknown[] = [];
  
  for await (const dbResult of result) {
    for (const [database, data] of Object.entries(dbResult)) {
      let sheetData: unknown[] = [];
      if (Array.isArray(data)) {
        sheetData = data.map(item => ({ database, ...item }));
      } else if (data && typeof data === 'object') {
        sheetData = [{ database, ...data }];
      } else {
        sheetData = [{ database, value: data }];
      }
      allData.push(...sheetData);
    }
  }
  
  if (allData.length === 0) {
    return false;
  }
  
  const worksheet = XLSX.utils.json_to_sheet(allData);
  XLSX.utils.book_append_sheet(workbook, worksheet, "Combined");
  return true;
}

export const XlsOutputStrategy = <TData>(unique: boolean = false, filename: string): OutputStrategy<TData, string> => async (result) => {
  const workbook = XLSX.utils.book_new();
  
  if (unique) {
    const hasData = await processCombinedSheet(result, workbook);
    if (!hasData) {
      const emptyWorksheet = XLSX.utils.json_to_sheet([{ message: "No data available" }]);
      XLSX.utils.book_append_sheet(workbook, emptyWorksheet, "Empty");
    }
  } else {
    const hasData = await processSeparateSheets(result, workbook);
    if (!hasData) {
      const emptyWorksheet = XLSX.utils.json_to_sheet([{ message: "No data available" }]);
      XLSX.utils.book_append_sheet(workbook, emptyWorksheet, "Empty");
    }
  }
  
  filename = filename.replace(/\.(xlsx|xls)$/, '');
  filename = filename.replace(/\s+/g, '_');
  filename = filename.replace(/[^\w\s-]/g, '');

  filename = `${filename}-${new Date().toISOString()}.xlsx`;

  try {
    XLSX.writeFile(workbook, filename);
  } catch (error) {
    console.error('Error writing Excel file:', error);
  }

  return filename;
};
import * as XLSX from 'xlsx';
import type { OutputStrategy } from '../index';

async function processSeparateSheets<TData>(
  result: ReadableStream<Record<string, TData>>,
  workbook: XLSX.WorkBook
): Promise<boolean> {
  let hasData = false;
  
  for await (const dbResult of result) {
    for (const [database, data] of Object.entries(dbResult)) {
      let sheetData: any[] = [];
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
  let allData: any[] = [];
  
  for await (const dbResult of result) {
    for (const [database, data] of Object.entries(dbResult)) {
      let sheetData: any[] = [];
      if (Array.isArray(data)) {
        sheetData = data.map(item => ({ ...item, database }));
      } else if (data && typeof data === 'object') {
        sheetData = [{ ...data, database }];
      } else {
        sheetData = [{ value: data, database }];
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

export const XlsOutputStrategy = <TData>(unique: boolean = false, filename: string): OutputStrategy<TData, void> => async (result) => {
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
  
  XLSX.writeFile(workbook, filename);
};
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
  const databaseGroups: { [database: string]: { startRow: number, endRow: number } } = {};
  let currentRow = 1; // Start from row 1 (header is row 0)
  
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
      
      // Track the start row for this database group
      databaseGroups[database] ??= { startRow: currentRow, endRow: currentRow };
      
      // Update the end row for this database group
      databaseGroups[database].endRow = currentRow + sheetData.length - 1;
      currentRow += sheetData.length;
      
      allData.push(...sheetData);
    }
  }
  
  if (allData.length === 0) {
    return false;
  }
  
  const worksheet = XLSX.utils.json_to_sheet(allData);
  
  worksheet['!rows'] ??= [];
  
  // Set row grouping for each database
  for (const [_, { startRow, endRow }] of Object.entries(databaseGroups)) {
    // Set level 1 for all rows in this database group
    for (let i = startRow; i <= endRow; i++) {
      worksheet['!rows'][i] ??= {hpx: 20};
      worksheet['!rows'][i]!.level = i === endRow ? 0 : 1;
    }
  }
  
  XLSX.utils.book_append_sheet(workbook, worksheet, "Combined");
  return true;
}

export const XlsOutputStrategy = <TData>(unique: boolean = false): OutputStrategy<TData, string> => async (result) => {
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

  let filename = process.argv[1]?.replace(/\.(?:js|ts)/, '');
  filename = `${filename}-${Date.now()}.xlsx`;

  try {
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', cellStyles: true });
    await Bun.write(filename, buffer);
    return filename;
  } catch (error) {
    console.error('Error writing Excel file');
    throw error;
  }
};
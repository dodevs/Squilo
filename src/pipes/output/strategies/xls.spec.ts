import { describe, expect, test } from "bun:test";
import { XlsOutputStrategy } from "./index";
import * as XLSX from "xlsx";

describe("XlsOutputStrategy", () => {
  test("should generate XLS file with separate sheets", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({
          database: "database1",
          data: [{ id: 1, name: "Alice", age: 30 }, { id: 2, name: "Bob", age: 25 }]
        });
        controller.enqueue({
          database: "database2",
          data: [{ id: 3, name: "Charlie", age: 35 }]
        });
        controller.close();
      }
    });

    const strategy = XlsOutputStrategy(false);
    const [_, filename] = await strategy(mockData);

    const file = Bun.file(filename);

    expect(await file.exists()).toBe(true);

    const workbook = XLSX.read(await file.arrayBuffer(), { cellStyles: true });
    expect(workbook.SheetNames).toEqual(["database1", "database2"]);

    // Clean up
    await Bun.file(filename).delete();
  });

  test("should generate XLS file with combined sheet when unique=true", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({
          database: "database1",
          data: [{ id: 1, name: "Alice", age: 30 }]
        });
        controller.enqueue({
          database: "database2",
          data: [{ id: 2, name: "Bob", age: 25 }]
        });
        controller.close();
      }
    });

    const strategy = XlsOutputStrategy(true);
    const [_, filename] = await strategy(mockData);

    const file = Bun.file(filename);

    expect(await file.exists()).toBe(true);

    const workbook = XLSX.read(await file.arrayBuffer(), { cellStyles: true });
    expect(workbook.SheetNames).toEqual(["Combined"]);

    // Clean up
    await Bun.file(filename).delete();
  });

  test("should create empty sheet when no data provided", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({});
        controller.close();
      }
    });

    const strategy = XlsOutputStrategy(false);
    const [_, filename] = await strategy(mockData);

    expect(await Bun.file(filename).exists()).toBe(true);

    // Clean up
    await Bun.file(filename).delete();
  });

  test("Should group rows by database when unique=true", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({
          database: "database1",
          data: [{ id: 1, name: "Alice", age: 30 }, { id: 2, name: "Bob", age: 25 }]
        });
        controller.enqueue({
          database: "database2",
          data: [{ id: 1, name: "Charlie", age: 35 }, { id: 2, name: "Dave", age: 40 }]
        });
        controller.close();
      }
    });

    const strategy = XlsOutputStrategy(true);
    const [_, filename] = await strategy(mockData);

    const file = Bun.file(filename);

    expect(await file.exists()).toBe(true);

    const workbook = XLSX.read(await file.arrayBuffer(), { cellStyles: true });
    const worksheet = workbook.Sheets["Combined"];
    expect(worksheet).toBeDefined();

    const rows = worksheet!['!rows']!;
    // Check if row grouping is set correctly
    expect(rows[1]!.level).toEqual(1); // Summary row for database1
    expect(rows[3]!.level).toEqual(1); // Summary row for database2

    // Clean up
    await Bun.file(filename).delete();
  });
});
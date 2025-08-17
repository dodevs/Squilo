import { describe, expect, test } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { XlsOutputStrategy } from "./index";

describe("XlsOutputStrategy", () => {
  test("should generate XLS file with separate sheets", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ 
          "database1": [{ id: 1, name: "Alice", age: 30 }, { id: 2, name: "Bob", age: 25 }],
          "database2": [{ id: 3, name: "Charlie", age: 35 }]
        });
        controller.close();
      }
    });

    const testFile = "/tmp/test-separate.xlsx";
    const strategy = XlsOutputStrategy(false, testFile);
    await strategy(mockData);
    
    expect(existsSync(testFile)).toBe(true);
    
    // Clean up
    unlinkSync(testFile);
  });

  test("should generate XLS file with combined sheet when unique=true", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ 
          "database1": [{ id: 1, name: "Alice", age: 30 }],
          "database2": [{ id: 2, name: "Bob", age: 25 }]
        });
        controller.close();
      }
    });

    const testFile = "/tmp/test-combined.xlsx";
    const strategy = XlsOutputStrategy(true, testFile);
    await strategy(mockData);
    
    expect(existsSync(testFile)).toBe(true);
    
    // Clean up
    unlinkSync(testFile);
  });

  test("should create empty sheet when no data provided", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({});
        controller.close();
      }
    });

    const testFile = "/tmp/test-empty.xlsx";
    const strategy = XlsOutputStrategy(false, testFile);
    await strategy(mockData);
    
    expect(existsSync(testFile)).toBe(true);
    
    // Clean up
    unlinkSync(testFile);
  });
});
import { describe, expect, test } from "bun:test";
import { JsonOutputStrategy, XlsOutputStrategy } from "./strategies";

describe("Output Strategies", () => {
  test("JsonOutputStrategy should format data as JSON with database keys", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ "database2": [{ id: 3, name: "Charlie" }] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy();
    const result = await strategy(mockData);
    
    expect(typeof result).toBe("string");
    expect(JSON.parse(result)).toEqual({
      "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      "database2": [{ id: 3, name: "Charlie" }]
    });
  });

  test("XlsOutputStrategy should generate XLS file with separate sheets", async () => {
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
    
    expect(require('fs').existsSync(testFile)).toBe(true);
    
    // Clean up
    require('fs').unlinkSync(testFile);
  });

  test("XlsOutputStrategy should generate XLS file with combined sheet when unique=true", async () => {
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
    
    expect(require('fs').existsSync(testFile)).toBe(true);
    
    // Clean up
    require('fs').unlinkSync(testFile);
  });
});
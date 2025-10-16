import { describe, expect, test } from "bun:test";
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

    const strategy = XlsOutputStrategy(false);
    const filename = await strategy(mockData);
    
    expect(await Bun.file(filename).exists()).toBe(true);
    
    // Clean up
    await Bun.file(filename).delete();
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

    const strategy = XlsOutputStrategy(true);
    const filename = await strategy(mockData);
    
    expect(await Bun.file(filename).exists()).toBe(true);
    
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
    const filename = await strategy(mockData);
    
    expect(await Bun.file(filename).exists()).toBe(true);
    
    // Clean up
    await Bun.file(filename).delete();
  });
});
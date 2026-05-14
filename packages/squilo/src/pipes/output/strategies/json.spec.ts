import { describe, expect, test } from "bun:test";
import { JsonOutputStrategy } from "./index";
import type { ErrorType, ExecutionResult } from "../../shared/runner/types";

describe("JsonOutputStrategy", () => {
  test("should write JSON data to file and return filename", async () => {
    const mockData = new ReadableStream<ExecutionResult<string, unknown>>({
      start(controller) {
        controller.enqueue({ database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: "database2", data: [{ id: 3, name: "Charlie" }] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy(true, true);
    const result = await strategy(mockData);

    // Verify file exists and contains correct data
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual([
      { database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] },
      { database: "database2", data: [{ id: 3, name: "Charlie" }] }
    ]);

    // Clean up
    await Bun.$`rm ${result}`;
  });

  test("Should merge database object to result", async () => {
    const mockData = new ReadableStream<ExecutionResult<{Id: string, Database: string}, unknown>>({
      start(controller) {
        controller.enqueue({ database: { Id: "1", Database: "database1" }, data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: { Id: "2", Database: "database2" }, data: [{ id: 3, name: "Charlie" }] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy(true, true);
    const result = await strategy(mockData);

    // Verify file exists and contains correct data
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual([
      { database: { Id: "1", Database: "database1" }, data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] },
      { database: { Id: "2", Database: "database2" }, data: [{ id: 3, name: "Charlie" }] }
    ]);

    // Clean up
    await Bun.$`rm ${result}`;
  })

  test("should handle some empty data", async () => {
    const mockData = new ReadableStream<ExecutionResult<string, unknown>>({
      start(controller) {
        controller.enqueue({ database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: "database2", data: [] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy(false, true);
    const result = await strategy(mockData);

    // Verify file exists and contains empty object
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual([
      { database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] }
    ]);

    // Clean up
    await Bun.$`rm ${result}`;
  });

  test("should handle some errors", async () => {
    const error = new Error("Test error");
    const mockData = new ReadableStream<ExecutionResult<string, unknown>>({
      start(controller) {
        controller.enqueue({ database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: "database2", error: { message: error.message } as ErrorType});
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy(true, true);
    const result = await strategy(mockData);

    // Verify file exists and contains error object
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual([
      { database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] },
      { database: "database2", error: { message: error.message } }
    ]);

    // Clean up
    await Bun.$`rm ${result}`;
  });

  test("should handle returned errors", async () => {
    const error = new Error("Test error");
    const mockData = new ReadableStream<ExecutionResult<string, unknown>>({
      start(controller) {
        controller.enqueue({ database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: "database2", error: { message: error.message } as ErrorType});
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy(true, false);
    const [errors, result] = await strategy(mockData);

    expect(errors).toHaveLength(1);
    expect(errors[0]?.error).toHaveProperty("message");
    expect(errors[0]?.error.message).toBe(error.message);

    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual([
      { database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] }
    ]);

    await Bun.$`rm ${result}`;
  });
});
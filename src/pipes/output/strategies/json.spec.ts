import { describe, expect, test } from "bun:test";
import { JsonOutputStrategy } from "./index";

describe("JsonOutputStrategy", () => {
  test("should write JSON data to file and return filename", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ "database2": [{ id: 3, name: "Charlie" }] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy("test-output");
    const result = await strategy(mockData);
    
    expect(typeof result).toBe("string");
    expect(result).toMatch(/test-output-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.json$/);
    
    // Verify file exists and contains correct data
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual({
      "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      "database2": [{ id: 3, name: "Charlie" }]
    });
    
    // Clean up
    await Bun.$`rm ${result}`;
  });

  test("should handle empty data and create file", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({});
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy("empty-test");
    const result = await strategy(mockData);
    
    expect(typeof result).toBe("string");
    expect(result).toMatch(/empty-test-\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.json$/);
    
    // Verify file exists and contains empty object
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual({});
    
    // Clean up
    await Bun.$`rm ${result}`;
  });
});
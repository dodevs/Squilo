import { describe, expect, test } from "bun:test";
import { JsonOutputStrategy } from "./index";

describe("JsonOutputStrategy", () => {
  test("should write JSON data to file and return filename", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: "database2", data: [{ id: 3, name: "Charlie" }] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy();
    const result = await strategy(mockData);

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

  test("should handle some empty data", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ database: "database1", data: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ database: "database2", data: [] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy(false);
    const result = await strategy(mockData);

    // Verify file exists and contains empty object
    const fileContent = await Bun.file(result).text();
    const parsedData = JSON.parse(fileContent);
    expect(parsedData).toEqual({
      "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]
    });

    // Clean up
    await Bun.$`rm ${result}`;
  });
});
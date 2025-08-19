import { describe, expect, test } from "bun:test";
import { JsonOutputStrategy } from "./index";

describe("JsonOutputStrategy", () => {
  test("should format data as JSON with database keys", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({ "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        controller.enqueue({ "database2": [{ id: 3, name: "Charlie" }] });
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy();
    const result = await strategy(mockData);
    
    expect(typeof result).toBe("object");
    expect(result).toEqual({
      "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }],
      "database2": [{ id: 3, name: "Charlie" }]
    });
  });

  test("should handle empty data", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({});
        controller.close();
      }
    });

    const strategy = JsonOutputStrategy();
    const result = await strategy(mockData);
    
    expect(typeof result).toBe("object");
    expect(result).toEqual({});
  });
});
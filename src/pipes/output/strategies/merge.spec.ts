import { describe, expect, test } from "bun:test";
import { MergeOutputStrategy } from "./index";

describe("MergeOutputStrategy", () => {
  test("should merge array data from multiple sources", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({database: "database1", data: [1, 2, 3, 4, 5]});
        controller.enqueue({database: "database2", data: [6, 7, 8, 9, 10]});
        controller.close();
      }
    });

    const strategy = MergeOutputStrategy<string, number[]>();
    const [_, result] = await strategy(mockData);
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("should handle empty arrays", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({database: "database1", data: []});
        controller.enqueue({database: "database2", data: []});
        controller.close();
      }
    });

    const strategy = MergeOutputStrategy<string, number[]>();
    const [_, result] = await strategy(mockData);
    
    expect(result).toEqual([]);
  });

  test("should merge object arrays", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({database: "database1", data: [{ id: 1, name: "Alice" }]});
        controller.enqueue({database: "database2", data: [{ id: 2, name: "Bob" }]});
        controller.close();
      }
    });

    const strategy = MergeOutputStrategy<string, { id: number; name: string }[]>();
    const [_, result] = await strategy(mockData);
    
    expect(result).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]);
  });
});
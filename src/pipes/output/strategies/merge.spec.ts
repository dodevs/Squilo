import { describe, expect, test } from "bun:test";
import { MergeOutputStrategy } from "./index";

describe("MergeOutputStrategy", () => {
  test("should merge array data from multiple sources", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({"database1": [1, 2, 3, 4, 5]});
        controller.enqueue({"database2": [6, 7, 8, 9, 10]});
        controller.close();
      }
    });

    const strategy = MergeOutputStrategy<number[]>();
    const result = await strategy(mockData);
    expect(result).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("should handle empty arrays", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({"database1": []});
        controller.enqueue({"database2": []});
        controller.close();
      }
    });

    const strategy = MergeOutputStrategy<number[]>();
    const result = await strategy(mockData);
    
    expect(result).toEqual([]);
  });

  test("should merge object arrays", async () => {
    const mockData = new ReadableStream({
      start(controller) {
        controller.enqueue({"database1": [{ id: 1, name: "Alice" }]});
        controller.enqueue({"database2": [{ id: 2, name: "Bob" }]});
        controller.close();
      }
    });

    const strategy = MergeOutputStrategy<{ id: number; name: string }[]>();
    const result = await strategy(mockData);
    
    expect(result).toEqual([
      { id: 1, name: "Alice" },
      { id: 2, name: "Bob" }
    ]);
  });
});
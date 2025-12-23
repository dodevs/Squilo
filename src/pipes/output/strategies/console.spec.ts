import { describe, expect, test } from 'bun:test';
import { ConsoleOutputStrategy } from './console';

describe("ConsoleOutputStrategy", () => {
    test("should log data to console", async () => {
        const mockData = new ReadableStream({
            start(controller) {
                controller.enqueue({ "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
                controller.close();
            }
        });
        const strategy = ConsoleOutputStrategy();

        for await (const data of mockData) {
            expect(data).toEqual({ "database1": [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }] });
        }
        await strategy(mockData);
    });
})
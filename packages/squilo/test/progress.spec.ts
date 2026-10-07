import { afterEach, describe, expect, test } from "bun:test";
import { Progress } from "../src/pipes/shared/progress";

describe("Progress", () => {
  const original = process.env.NODE_ENV;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = original;
    }
  });

  test("Should be silent under NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const progress = Progress();

    expect(progress).toBe(Progress());
    expect(() => {
      progress.start(1);
      progress.update("a");
      progress.increment("a");
      progress.stop();
    }).not.toThrow();
  });

  test("Should drive a real progress bar outside tests", () => {
    process.env.NODE_ENV = "production";
    const progress = Progress();

    expect(progress).not.toBe(Progress());
    expect(() => {
      progress.start(2);
      progress.update("a");
      progress.increment("a");
      progress.increment("b");
      progress.stop();
    }).not.toThrow();
  });
});

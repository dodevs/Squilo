import { describe, expect, test } from "bun:test";
import { IsTransientError } from "../src/pipes/shared/runner/transient";

const sqlError = (props: { number?: number; code?: string }) => Object.assign(new Error("sql"), props);

describe("IsTransientError", () => {
  test("Should retry deadlocks, throttling and dropped connections", () => {
    expect(IsTransientError(sqlError({ number: 1205 }))).toBe(true);
    expect(IsTransientError(sqlError({ number: 40501 }))).toBe(true);
    expect(IsTransientError(sqlError({ code: "ESOCKET" }))).toBe(true);
    expect(IsTransientError(sqlError({ code: "ETIMEOUT" }))).toBe(true);
  });

  test("Should not retry permanent errors", () => {
    expect(IsTransientError(sqlError({ number: 208 }))).toBe(false); // Invalid object name
    expect(IsTransientError(sqlError({ code: "ELOGIN" }))).toBe(false);
    expect(IsTransientError(new Error("boom"))).toBe(false);
    expect(IsTransientError("boom")).toBe(false);
    expect(IsTransientError(undefined)).toBe(false);
  });
});

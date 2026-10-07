import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionPool } from "mssql";
import type { Pool } from "../src/pool";
import { Connect as RawConnect } from "../src/pipes/connect";
import type { AuthenticationChain } from "../src/pipes/auth/types";
import type { OutputStrategy } from "../src/pipes/output/strategies/types";
import type { ExecutionResult } from "../src/pipes/shared/runner/types";

const Connect = (pool: Pool) => RawConnect(pool) as AuthenticationChain["Connect"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const Collect = <T, TReturn>(): OutputStrategy<T, TReturn, ExecutionResult<T, TReturn>[]> => async (stream) => {
  const results: ExecutionResult<T, TReturn>[] = [];
  for await (const result of stream) {
    results.push(result);
  }
  return results;
};

/** In-memory Pool: records lifecycle events and lets each test decide which connections fail. */
const FakePool = (options: { failConnect?: string[]; discovery?: () => Promise<unknown[]> } = {}) => {
  const events: string[] = [];

  const pool: Pool = {
    connect: ({ database }) => async () => {
      if (options.failConnect?.includes(database!)) {
        throw new Error(`Login failed for ${database}`);
      }

      return {
        close: async () => {
          events.push(`close:${database}`);
        },
        request: () => ({
          query: async () => ({ recordset: await options.discovery!() }),
        }),
      } as unknown as ConnectionPool;
    },
  };

  return { pool, events };
};

describe("Runner", () => {
  let originalSafeGuard: string | undefined;

  beforeAll(() => {
    originalSafeGuard = process.env.SAFE_GUARD;
  });

  beforeEach(() => {
    process.env.SAFE_GUARD = "0";
  });

  afterAll(() => {
    if (originalSafeGuard !== undefined) {
      process.env.SAFE_GUARD = originalSafeGuard;
    } else {
      delete process.env.SAFE_GUARD;
    }
  });

  test("Should emit one result per database", async () => {
    const { pool } = FakePool();

    const results = await Connect(pool)(["a", "b", "c"])
      .Retrieve(async (_, database) => database.toUpperCase())
      .Output(Collect());

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.data).sort()).toEqual(["A", "B", "C"]);
    expect(results.every((r) => r.error === undefined)).toBe(true);
  });

  test("Should start the next database as soon as any slot frees up", async () => {
    const { pool, events } = FakePool();
    const delays: Record<string, number> = { a: 300, b: 10, c: 50, d: 10 };

    await Connect(pool)(["a", "b", "c", "d"], 2).Execute(async (_, database) => {
      events.push(`start:${database}`);
      await sleep(delays[database]!);
      events.push(`end:${database}`);
    });

    // With fixed batches of 2, "c" would only start after "a" (the slow one) finished.
    expect(events.indexOf("start:c")).toBeLessThan(events.indexOf("end:a"));
    expect(events.indexOf("start:d")).toBeLessThan(events.indexOf("end:a"));
  });

  test("Should never exceed the concurrency limit", async () => {
    const { pool } = FakePool();
    let inFlight = 0;
    let maxInFlight = 0;

    await Connect(pool)(["a", "b", "c", "d", "e", "f"], 2).Execute(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await sleep(20);
      inFlight--;
    });

    expect(maxInFlight).toBe(2);
  });

  test("Should run every database at once when concurrency is omitted", async () => {
    const { pool } = FakePool();
    let inFlight = 0;
    let maxInFlight = 0;

    await Connect(pool)(["a", "b", "c", "d"]).Execute(async () => {
      maxInFlight = Math.max(maxInFlight, ++inFlight);
      await sleep(20);
      inFlight--;
    });

    expect(maxInFlight).toBe(4);
  });

  test("Should run the first SAFE_GUARD databases one at a time", async () => {
    process.env.SAFE_GUARD = "2";
    const { pool, events } = FakePool();

    await Connect(pool)(["a", "b", "c", "d"]).Execute(async (_, database) => {
      events.push(`start:${database}`);
      await sleep(10);
      events.push(`end:${database}`);
    });

    const runs = events.filter((e) => !e.startsWith("close:"));
    expect(runs.slice(0, 4)).toEqual(["start:a", "end:a", "start:b", "end:b"]);
    expect(runs.slice(4, 6).sort()).toEqual(["start:c", "start:d"]);
  });

  test("Should stop after SAFE_GUARD errors and skip the remaining databases", async () => {
    process.env.SAFE_GUARD = "2";
    const { pool } = FakePool();
    const called: string[] = [];

    const errors = await Connect(pool)(["a", "b", "c", "d", "e"]).Execute(async (_, database) => {
      called.push(database);
      throw new Error("Invalid object name 'NonExistentTable'.");
    });

    expect(called).toEqual(["a", "b"]);
    expect(errors.map((e) => e.database)).toEqual(["a", "b"]);
  });

  test("Should report every error when SAFE_GUARD is disabled", async () => {
    const { pool } = FakePool();

    const errors = await Connect(pool)(["a", "b", "c"]).Execute(async () => {
      throw new Error("boom");
    });

    expect(errors).toHaveLength(3);
    expect(errors[0]).toEqual({ database: expect.any(String), error: expect.objectContaining({ message: "boom" }) });
  });

  test("Should report connection failures as errors without calling fn", async () => {
    const { pool } = FakePool({ failConnect: ["b"] });
    const called: string[] = [];

    const results = await Connect(pool)(["a", "b", "c"])
      .Retrieve(async (_, database) => {
        called.push(database);
        return database;
      })
      .Output(Collect());

    expect(called.sort()).toEqual(["a", "c"]);
    const failed = results.find((r) => r.database === "b");
    expect(failed?.data).toBeUndefined();
    expect(failed?.error?.message).toBe("Login failed for b");
  });

  test("Should close every connection, including when fn throws", async () => {
    const { pool, events } = FakePool();

    await Connect(pool)(["a", "b"]).Execute(async (_, database) => {
      if (database === "b") throw new Error("boom");
    });

    expect(events.sort()).toEqual(["close:a", "close:b"]);
  });

  test("Should run against databases returned by the discovery query", async () => {
    const { pool } = FakePool({ discovery: async () => [{ Database: "a" }, { Database: "b" }] });

    const results = await Connect(pool)<{ Database: string }>({
      database: "Manager",
      query: "SELECT DatabaseName as [Database] FROM Clients",
    })
      .Retrieve(async (_, database) => database.Database)
      .Output(Collect());

    expect(results.map((r) => r.database).sort((x, y) => x.Database.localeCompare(y.Database))).toEqual([
      { Database: "a" },
      { Database: "b" },
    ]);
  });

  test("Should reject Output instead of hanging when discovery fails", async () => {
    const { pool } = FakePool({ failConnect: ["Manager"] });

    const output = Connect(pool)<{ Database: string }>({
      database: "Manager",
      query: "SELECT DatabaseName as [Database] FROM Clients",
    })
      .Retrieve(async () => 1)
      .Output(Collect());

    await expect(output).rejects.toThrow("Login failed for Manager");
  });

  test("Should reject Execute when discovery fails", async () => {
    const { pool } = FakePool({ failConnect: ["Manager"] });

    const execution = Connect(pool)<{ Database: string }>({
      database: "Manager",
      query: "SELECT DatabaseName as [Database] FROM Clients",
    }).Execute(async () => { });

    await expect(execution).rejects.toThrow("Login failed for Manager");
  });
});

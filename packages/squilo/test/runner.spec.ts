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
        // tarn pool internals used by ForceClose: one busy connection per database
        pool: { used: [{ resource: { close: () => events.push(`kill:${database}`) } }] },
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

  describe("retry", () => {
    const deadlock = () => Object.assign(new Error("Transaction was deadlocked"), { number: 1205 });

    test("Should retry transient errors on a fresh connection until it succeeds", async () => {
      const { pool, events } = FakePool();
      let attempts = 0;

      const errors = await Connect(pool)(["a"], { retry: { times: 3, delay: 1 } }).Execute(async () => {
        attempts++;
        if (attempts < 3) throw deadlock();
      });

      expect(errors).toEqual([]);
      expect(attempts).toBe(3);
      expect(events).toEqual(["close:a", "close:a", "close:a"]);
    });

    test("Should report the last error once retries are exhausted", async () => {
      const { pool } = FakePool();
      let attempts = 0;

      const errors = await Connect(pool)(["a"], { retry: { times: 2, delay: 1 } }).Execute(async () => {
        attempts++;
        throw deadlock();
      });

      expect(attempts).toBe(3);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.error).toEqual(expect.objectContaining({ number: 1205 }));
    });

    test("Should not retry permanent errors", async () => {
      const { pool } = FakePool();
      let attempts = 0;

      const errors = await Connect(pool)(["a"], { retry: 3 }).Execute(async () => {
        attempts++;
        throw Object.assign(new Error("Invalid object name 'Nope'."), { number: 208 });
      });

      expect(attempts).toBe(1);
      expect(errors).toHaveLength(1);
    });

    test("Should use a custom predicate", async () => {
      const { pool } = FakePool();
      let attempts = 0;

      await Connect(pool)(["a"], { retry: { times: 2, delay: 1, while: (e) => e.message === "flaky" } }).Execute(async () => {
        attempts++;
        throw new Error("flaky");
      });

      expect(attempts).toBe(3);
    });

    test("Should retry a deadlock hidden in the SuppressedError of await using", async () => {
      const { pool } = FakePool();
      let attempts = 0;

      const errors = await Connect(pool)(["a"], { retry: { times: 1, delay: 1 } }).Execute(async () => {
        attempts++;
        if (attempts === 1) throw new SuppressedError(new Error("Transaction has been aborted."), deadlock());
      });

      expect(errors).toEqual([]);
      expect(attempts).toBe(2);
    });

    test("Should count only the final failure towards SAFE_GUARD", async () => {
      process.env.SAFE_GUARD = "1";
      const { pool } = FakePool();
      const attempts: Record<string, number> = {};

      const errors = await Connect(pool)(["a", "b"], { retry: { times: 1, delay: 1 } }).Execute(async (_, database) => {
        attempts[database] = (attempts[database] ?? 0) + 1;
        if (database === "a" && attempts[database] === 1) throw deadlock();
      });

      expect(errors).toEqual([]);
      expect(attempts).toEqual({ a: 2, b: 1 });
    });
  });

  describe("timeout", () => {
    test("Should fail a database that exceeds its budget and force-close its connection", async () => {
      const { pool, events } = FakePool();
      const started = Date.now();

      const errors = await Connect(pool)(["slow", "fast"], { timeout: 50 }).Execute(async (_, database) => {
        await sleep(database === "slow" ? 2000 : 5);
      });

      expect(Date.now() - started).toBeLessThan(1000);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.database).toBe("slow");
      expect(errors[0]?.error).toEqual(expect.objectContaining({ name: "TimeoutError", message: "Execution timed out after 50ms" }));
      expect(events).toContain("kill:slow");
      expect(events).toContain("close:fast");
      expect(events).not.toContain("kill:fast");
    });

    test("Should include retries in the budget", async () => {
      const { pool } = FakePool();
      let attempts = 0;

      const errors = await Connect(pool)(["a"], { timeout: "100 millis", retry: { times: 100, delay: 30 } }).Execute(async () => {
        attempts++;
        throw Object.assign(new Error("deadlock"), { number: 1205 });
      });

      expect(errors[0]?.error).toEqual(expect.objectContaining({ name: "TimeoutError" }));
      expect(attempts).toBeLessThan(10);
    });
  });

  describe("signal", () => {
    test("Should abort in-flight databases and skip the ones not started", async () => {
      const { pool, events } = FakePool();
      const controller = new AbortController();
      const called: string[] = [];
      setTimeout(() => controller.abort(), 50);

      const started = Date.now();
      const errors = await Connect(pool)(["a", "b", "c"], { concurrent: 1, signal: controller.signal }).Execute(async (_, database) => {
        called.push(database);
        await sleep(2000);
      });

      expect(Date.now() - started).toBeLessThan(1000);
      expect(called).toEqual(["a"]);
      expect(errors).toEqual([{ database: "a", error: expect.objectContaining({ name: "AbortError" }) }]);
      expect(events).toContain("kill:a");
    });

    test("Should keep the results obtained before aborting", async () => {
      const { pool } = FakePool();
      const controller = new AbortController();

      const results = await Connect(pool)(["a", "b", "c"], { concurrent: 1, signal: controller.signal })
        .Retrieve(async (_, database) => {
          if (database === "b") {
            controller.abort();
            await sleep(2000);
          }
          return database;
        })
        .Output(Collect());

      expect(results.map((r) => [r.database, r.data ?? r.error?.name])).toEqual([["a", "a"], ["b", "AbortError"]]);
    });

    test("Should run nothing when the signal is already aborted", async () => {
      const { pool } = FakePool();
      let called = false;

      const errors = await Connect(pool)(["a", "b"], { signal: AbortSignal.abort() }).Execute(async () => {
        called = true;
      });

      expect(called).toBe(false);
      expect(errors).toEqual([]);
    });
  });
});

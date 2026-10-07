import { beforeAll, afterAll, describe, expect, test } from "bun:test";

import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers } from "./container/setup/users";
import { LoadEnv } from "../src/utils/load-env";
import { MergeOutputStrategy } from "../src/pipes/output/strategies";
import type { ConnectionPoolWrapper } from "../src/pool";

describe("Error handling and logging tests", async () => {
  const container = await AzureSqlEdge();
  const localServer = Server({
    server: container.getHost(),
    port: container.getMappedPort(1433),
    options: {
      encrypt: false,
    },
  }).Auth(UserAndPassword("sa", SQL_PASSWORD));

  let originalSafeGuard: string | undefined;

  beforeAll(async () => {
    await SetupDatabases(container);
    await SetupUsers(container, { populate: false, quantity: 10 });

    originalSafeGuard = process.env.SAFE_GUARD;
  });

  afterAll(async () => {
    if (originalSafeGuard !== undefined) {
      process.env.SAFE_GUARD = originalSafeGuard;
    } else {
      delete process.env.SAFE_GUARD;
    }
  });

  describe("Environment variable loading", () => {
    test("Should load default SAFE_GUARD value when not set", () => {
      delete process.env.SAFE_GUARD;
      const env = LoadEnv();
      expect(env.SAFE_GUARD).toBe(1);
    });

    test("Should load custom SAFE_GUARD value from environment", () => {
      process.env.SAFE_GUARD = "5";
      const env = LoadEnv();
      expect(env.SAFE_GUARD).toBe(5);
    });

    test("Should handle invalid SAFE_GUARD value gracefully", () => {
      process.env.SAFE_GUARD = "invalid";
      const env = LoadEnv();
      expect(env.SAFE_GUARD).toBeNaN();
    });
  });

  describe("SAFE_GUARD behavior in retrieve operations", () => {
    test("Should create error log for database errors in retrieve", async () => {
      process.env.SAFE_GUARD = "2";

      const [errors, result] = await localServer
        .Connect(DATABASES)
        .Retrieve(async (conn) => {
          const result = await conn.query`SELECT * FROM NonExistentTable`;
          return result.recordset;
        })
        .Output(MergeOutputStrategy());

      expect(errors.length).toBe(2);
      expect(result).toEqual([]);
    });
  });

  describe("SAFE_GUARD behavior in execute operations", () => {
    test("Should create error log for database errors in execute", async () => {
      process.env.SAFE_GUARD = "2";

      const errors = await localServer
        .Connect(DATABASES)
        .Execute(async (conn) => {
          await conn.query`
            INSERT INTO NonExistentTable (Id, Name, Email) VALUES (1, 'John Doe', 'john.doe@test.com')
          `;
        });

      expect(errors.length).toBe(2);
    });
  });

  describe("Interrupted and unfinished executions", () => {
    const marker = "interrupted@test.com";

    const countMarker = async (database: string) => {
      const [, rows] = await localServer
        .Connect(database)
        .Retrieve(async (conn) => {
          const result = await conn.query<{ n: number }>`SELECT COUNT(*) AS n FROM Users WHERE Email = ${marker}`;
          return result.recordset;
        })
        .Output(MergeOutputStrategy());
      return rows[0]!.n;
    };

    const slowTransaction = async (conn: ConnectionPoolWrapper) => {
      await using tx = await conn.transaction$();
      await tx.request().query`
        INSERT INTO Users (Name, Email) VALUES ('Interrupted', ${marker});
        WAITFOR DELAY '00:00:10';
      `;
      await tx.commit$();
    };

    test("Should abort the running query on timeout and roll back its transaction", async () => {
      process.env.SAFE_GUARD = "0";
      const database = DATABASES[0]!;
      const started = Date.now();

      const errors = await localServer
        .Connect([database], { timeout: "1 second" })
        .Execute(slowTransaction);

      expect(Date.now() - started).toBeLessThan(5000);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.name).toBe("TimeoutError");
      expect(await countMarker(database)).toBe(0);
    });

    test("Should abort the running query on signal and roll back its transaction", async () => {
      process.env.SAFE_GUARD = "0";
      const database = DATABASES[1]!;
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1000);
      const started = Date.now();

      const errors = await localServer
        .Connect([database], { signal: controller.signal })
        .Execute(slowTransaction);

      expect(Date.now() - started).toBeLessThan(5000);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.name).toBe("AbortError");
      expect(await countMarker(database)).toBe(0);
    });

    test("Should fail a callback that leaves its transaction open, and roll it back", async () => {
      process.env.SAFE_GUARD = "0";
      const database = DATABASES[2]!;
      const started = Date.now();

      const errors = await localServer
        .Connect([database])
        .Execute(async (conn) => {
          const tx = await conn.transaction$(); // missing `await using` and `commit$()`
          await tx.request().query`INSERT INTO Users (Name, Email) VALUES ('Interrupted', ${marker})`;
        });

      expect(Date.now() - started).toBeLessThan(5000);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.error.name).toBe("UnfinishedWorkError");
      expect(await countMarker(database)).toBe(0);
    });
  });
});

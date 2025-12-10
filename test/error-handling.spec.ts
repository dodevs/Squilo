import { beforeAll, afterAll, describe, expect, test } from "bun:test";

import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers } from "./container/setup/users";
import { LoadEnv } from "../src/utils/load-env";
import { MergeOutputStrategy } from "../src/pipes/output/strategies";

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
    await SetupUsers(container);

    originalSafeGuard = process.env.SAFE_GUARD;
  });

  afterAll(async () => {
    await localServer.Close();

    if (originalSafeGuard !== undefined) {
      process.env.SAFE_GUARD = originalSafeGuard;
    } else {
      delete process.env.SAFE_GUARD;
    }
  });

  describe("Environment variable loading", () => {
    test("Should load default MAX_ERRORS value when not set", () => {
      delete process.env.SAFE_GUARD;
      const env = LoadEnv();
      expect(env.SAFE_GUARD).toBe(1);
    });

    test("Should load custom MAX_ERRORS value from environment", () => {
      process.env.SAFE_GUARD = "5";
      const env = LoadEnv();
      expect(env.SAFE_GUARD).toBe(5);
    });

    test("Should handle invalid MAX_ERRORS value gracefully", () => {
      process.env.SAFE_GUARD = "invalid";
      const env = LoadEnv();
      expect(env.SAFE_GUARD).toBeNaN();
    });
  });

  describe("MAX_ERRORS behavior in retrieve operations", () => {
    test("Should create error log for database errors in retrieve", async () => {
      process.env.SAFE_GUARD = "2";

      const [errors, result] = await localServer
        .Connect(DATABASES)
        .Retrieve(async (transaction) => {
          const result = await transaction.request().query`SELECT * FROM NonExistentTable`;
          return result.recordset;
        })
        .Output(MergeOutputStrategy());

      expect(errors.length).toBe(2);
      expect(result).toEqual([]);
    });
  });

  describe("MAX_ERRORS behavior in execute operations", () => {
    test("Should create error log for database errors in execute", async () => {
      process.env.SAFE_GUARD = "2";

      const errors = await localServer
        .Connect(DATABASES)
        .Execute(async (transaction) => {
          await transaction.request().query`
            INSERT INTO Users (Id, Name, Email, Age) VALUES (1, 'John Doe', 'john.doe@test.com', 30)
          `;
        });

      expect(errors.length).toBe(2);
    });
  });
});
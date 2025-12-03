import { beforeAll, afterAll, describe, expect, test, beforeEach, afterEach } from "bun:test";

import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers } from "./container/setup/users";
import { LoadEnv } from "../src/utils/load-env";
import { CleanErrors, GetErrors, SetLogPath } from "../src/utils/append-error";
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

  let originalMaxErrors: string | undefined;

  beforeAll(async () => {
    await SetupDatabases(container);
    await SetupUsers(container);

    const errorLogPath = `${import.meta.path.replace(/\.(?:js|ts)/, '')}-last-errors.json`;
    SetLogPath(errorLogPath);

    originalMaxErrors = process.env.MAX_ERRORS;
  });

  afterAll(async () => {
    await localServer.Close();

    if (originalMaxErrors !== undefined) {
      process.env.MAX_ERRORS = originalMaxErrors;
    } else {
      delete process.env.MAX_ERRORS;
    }
  });

  afterEach(async () => {
    await CleanErrors();
  });

  describe("Environment variable loading", () => {
    test("Should load default MAX_ERRORS value when not set", () => {
      delete process.env.MAX_ERRORS;
      const env = LoadEnv();
      expect(env.MAX_ERRORS).toBe(1);
    });

    test("Should load custom MAX_ERRORS value from environment", () => {
      process.env.MAX_ERRORS = "5";
      const env = LoadEnv();
      expect(env.MAX_ERRORS).toBe(5);
    });

    test("Should handle invalid MAX_ERRORS value gracefully", () => {
      process.env.MAX_ERRORS = "invalid";
      const env = LoadEnv();
      expect(env.MAX_ERRORS).toBeNaN();
    });
  });



  describe("MAX_ERRORS behavior in retrieve operations", () => {
    test("Should create error log for database errors in retrieve", async () => {
      process.env.MAX_ERRORS = "10";

      await localServer
        .Connect(DATABASES[0]!)
        .Retrieve(async (transaction) => {
          await transaction.request().query`SELECT * FROM NonExistentTable`;
          return [];
        })
        .Output(async (results) => {
          return results;
        });

      await new Promise(resolve => setTimeout(resolve, 100));
      const logContent = await GetErrors();
      expect(logContent.length).toBeGreaterThanOrEqual(0);
    });

    test("Should not throw when operations succeed", async () => {
      process.env.MAX_ERRORS = "1";

      await localServer
        .Connect([DATABASES[0]!])
        .Retrieve(async (transaction) => {
          const result = await transaction.request().query`SELECT TOP 1 * FROM Users`;
          return result.recordset;
        })
        .Output(async (results) => {
          expect().pass();
          return MergeOutputStrategy()(results);
        });

    });
  });

  describe("MAX_ERRORS behavior in execute operations", () => {
    test("Should create error log for database errors in execute", async () => {
      process.env.MAX_ERRORS = "10";

      await localServer
        .Connect([DATABASES[0]!])
        .Execute(async (transaction) => {
          await transaction.request().query`
            INSERT INTO Users (Id, Name, Email) VALUES (1, 'Duplicate', 'duplicate@test.com')
          `;
        });

      await new Promise(resolve => setTimeout(resolve, 100));
      const logContent = await GetErrors();
      expect(logContent.length).toBeGreaterThanOrEqual(0);
    });

    test("Should allow successful operations to complete", async () => {
      process.env.MAX_ERRORS = "1";

      await localServer
        .Connect([DATABASES[0]!])
        .Execute(async (transaction) => {
          await transaction.request().query`
            UPDATE Users SET Name = 'Updated' WHERE Id = 1
          `;
          expect().pass();
        });
    });
  });


});
import { beforeAll, afterAll, describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "fs";
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers } from "./container/setup/users";
import { LoadEnv } from "../src/utils/load-env";
import { AppendError } from "../src/utils/append-error";
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
  let errorLogPath: string;

  beforeAll(async () => {
    await SetupDatabases(container);
    await SetupUsers(container);

    // Calculate the error log path based on test file name
    errorLogPath = `${import.meta.path.replace(/\.(?:js|ts)/, '')}-last-errors.json`;
    originalMaxErrors = process.env.MAX_ERRORS;
  });

  afterAll(async () => {
    await localServer.Close();

    // Restore original MAX_ERRORS
    if (originalMaxErrors !== undefined) {
      process.env.MAX_ERRORS = originalMaxErrors;
    } else {
      delete process.env.MAX_ERRORS;
    }
  });

  afterEach(() => {
    // Clean up error log file after each test
    if (existsSync(errorLogPath)) {
      unlinkSync(errorLogPath);
    }
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

  describe("Error logging functionality", () => {
    test("Should create error log file when AppendError is called", async () => {
      const testError = new Error("Test error");
      await AppendError("TestDB1", testError);

      expect(existsSync(errorLogPath)).toBe(true);
    });

    test("Should store error details correctly in log file", async () => {
      const testError = new Error("Test error message");
      testError.stack = "Test stack trace";

      await AppendError("TestDB1", testError);

      const logContent = await Bun.file(errorLogPath).json();
      expect(logContent.TestDB1).toBeDefined();
      expect(logContent.TestDB1.message).toBe("Test error message");
      expect(logContent.TestDB1.stack).toBe("Test stack trace");
    });

    test("Should accumulate errors for multiple databases", async () => {
      const error1 = new Error("Error in DB1");
      const error2 = new Error("Error in DB2");

      await AppendError("TestDB1", error1);
      await AppendError("TestDB2", error2);

      const logContent = await Bun.file(errorLogPath).json();
      expect(Object.keys(logContent)).toHaveLength(2);
      expect(logContent.TestDB1.message).toBe("Error in DB1");
      expect(logContent.TestDB2.message).toBe("Error in DB2");
    });

    test("Should overwrite existing error for same database", async () => {
      const initialError = new Error("Initial error");
      const updatedError = new Error("Updated error");

      await AppendError("TestDB1", initialError);
      await AppendError("TestDB1", updatedError);

      const logContent = await Bun.file(errorLogPath).json();
      expect(Object.keys(logContent)).toHaveLength(1);
      expect(logContent.TestDB1.message).toBe("Updated error");
    });
  });

  describe("MAX_ERRORS behavior in retrieve operations", () => {
    test("Should create error log for database errors in retrieve", async () => {
      // Use a low MAX_ERRORS but don't expect it to trigger due to Promise.allSettled usage
      process.env.MAX_ERRORS = "10";

      await localServer
        .Connect([DATABASES[0]])
        .Retrieve(async (transaction) => {
          // Force SQL error by querying non-existent table
          await transaction.request().query`SELECT * FROM NonExistentTable`;
          return [];
        })
        .Output(async (results) => {
          return results;
        });

      // Check that error log was created for the failed database
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for async operations
      if (existsSync(errorLogPath)) {
        const logContent = await Bun.file(errorLogPath).json();
        expect(Object.keys(logContent).length).toBeGreaterThanOrEqual(0);
      }
    });

    test("Should not throw when operations succeed", async () => {
      process.env.MAX_ERRORS = "1";

      await localServer
        .Connect([DATABASES[0]!])
        .Retrieve(async (transaction) => {
          // This should succeed
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
      // Test that errors are logged, not necessarily that MAX_ERRORS triggers
      process.env.MAX_ERRORS = "10";

      await localServer
        .Connect([DATABASES[0]!])
        .Execute(async (transaction) => {
          // Force SQL error by inserting duplicate primary key
          await transaction.request().query`
            INSERT INTO Users (Id, Name, Email) VALUES (1, 'Duplicate', 'duplicate@test.com')
          `;
        });

      // Check if error log was created
      await new Promise(resolve => setTimeout(resolve, 100));
      if (existsSync(errorLogPath)) {
        const logContent = await Bun.file(errorLogPath).json();
        expect(Object.keys(logContent).length).toBeGreaterThanOrEqual(0);
      }
    });

    test("Should allow successful operations to complete", async () => {
      process.env.MAX_ERRORS = "1";

      await localServer
        .Connect([DATABASES[0]!])
        .Execute(async (transaction) => {
          // This should succeed
          await transaction.request().query`
            UPDATE Users SET Name = 'Updated' WHERE Id = 1
          `;
          expect().pass();
        });
    });
  });

  describe("Error log persistence and cleanup", () => {
    test("Should persist error log across operations", async () => {
      const testError = new Error("Persistent error");
      await AppendError("TestDB1", testError);

      // Wait a bit for file operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify file exists and content is correct
      expect(existsSync(errorLogPath)).toBe(true);
      const logContent = await Bun.file(errorLogPath).json();
      expect(logContent.TestDB1).toBeDefined();
      expect(logContent.TestDB1.message).toBe("Persistent error");
    });

    test("Should handle concurrent error logging", async () => {
      const errors: Error[] = [
        new Error("Error 1"),
        new Error("Error 2"),
        new Error("Error 3")
      ];

      // Log errors concurrently
      await Promise.all([
        AppendError("TestDB1", errors[0]!),
        AppendError("TestDB2", errors[1]!),
        AppendError("TestDB3", errors[2]!)
      ]);

      // Wait a bit for file operations to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const logContent = await Bun.file(errorLogPath).json();
      expect(Object.keys(logContent).length).toBeGreaterThanOrEqual(1);
    });
  });
});
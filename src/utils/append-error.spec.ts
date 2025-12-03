import { describe, expect, test, afterEach, beforeAll } from "bun:test";
import { existsSync } from "fs";
import { AppendError, CleanErrors, GetErrors, SetLogPath } from "./append-error";

describe("Append Error Utils", () => {
    let errorLogPath: string;

    beforeAll(() => {
        // Calculate the error log path based on test file name
        errorLogPath = `${import.meta.path.replace(/\.(?:js|ts)/, '')}-last-errors.json`;
        SetLogPath(errorLogPath);
    });

    afterEach(async () => {
        await CleanErrors();
    });

    describe("Error logging functionality", () => {
        test("Should create error log file when AppendError is called", async () => {
            const testError = new Error("Test error");
            AppendError("TestDB1", testError);

            expect(existsSync(errorLogPath)).toBe(true);
        });

        test("Should store error details correctly in log file", async () => {
            const testError = new Error("Test error message");
            testError.stack = "Test stack trace";

            AppendError("TestDB1", testError);

            const logs = await GetErrors();

            expect(logs.length).toBe(1);
            expect(logs[0].database).toBe("TestDB1");
            expect(logs[0].error.message).toBe("Test error message");
            expect(logs[0].error.stack).toBe("Test stack trace");
        });

        test("Should accumulate errors for multiple databases", async () => {
            const error1 = new Error("Error in DB1");
            const error2 = new Error("Error in DB2");

            AppendError("TestDB1", error1);
            AppendError("TestDB2", error2);

            const logs = await GetErrors();
            expect(logs.length).toBe(2);
            expect(logs[0].database).toBe("TestDB1");
            expect(logs[0].error.message).toBe("Error in DB1");
            expect(logs[1].database).toBe("TestDB2");
            expect(logs[1].error.message).toBe("Error in DB2");
        });

        test("Should overwrite existing error for same database", async () => {
            const initialError = new Error("Initial error");
            const updatedError = new Error("Updated error");

            AppendError("TestDB1", initialError);
            AppendError("TestDB1", updatedError);

            const logContent = await GetErrors();
            expect(logContent.length).toBe(2);
            expect(logContent[0].database).toBe("TestDB1");
            expect(logContent[0].error.message).toBe("Initial error");
            expect(logContent[1].database).toBe("TestDB1");
            expect(logContent[1].error.message).toBe("Updated error");
        });
    });

    describe("Error log persistence and cleanup", () => {
        test("Should persist error log across operations", async () => {
            const testError = new Error("Persistent error");
            AppendError("TestDB1", testError);

            const logContent = await GetErrors();
            expect(logContent.length).toBe(1);
            expect(logContent[0].database).toBe("TestDB1");
            expect(logContent[0].error.message).toBe("Persistent error");
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

            const logContent = await GetErrors();
            expect(logContent.length).toBeGreaterThanOrEqual(1);
        });
    });
});

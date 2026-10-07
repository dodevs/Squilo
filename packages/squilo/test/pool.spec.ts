import { describe, expect, test } from "bun:test";
import type { Transaction } from "mssql";
import { TransactionWrapper } from "../src/pool";

const FakeTransaction = (options: { failCommit?: boolean } = {}) => {
  const events: string[] = [];

  const transaction = {
    commit: async () => {
      events.push("commit");
      if (options.failCommit) {
        throw new Error("Commit failed");
      }
    },
    rollback: async () => {
      events.push("rollback");
    },
  } as unknown as Transaction;

  return { transaction, events };
};

describe("TransactionWrapper", () => {
  test("Should not roll back after a successful commit", async () => {
    const { transaction, events } = FakeTransaction();

    {
      await using tx = new TransactionWrapper(transaction);
      await tx.commit$();
    }

    expect(events).toEqual(["commit"]);
  });

  test("Should roll back when commit fails", async () => {
    const { transaction, events } = FakeTransaction({ failCommit: true });

    const run = async () => {
      await using tx = new TransactionWrapper(transaction);
      await tx.commit$();
    };

    await expect(run()).rejects.toThrow("Commit failed");
    expect(events).toEqual(["commit", "rollback"]);
  });
});

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

  test("Should extend the transaction itself instead of copying it", () => {
    const { transaction } = FakeTransaction();

    expect(new TransactionWrapper(transaction)).toBe(transaction as TransactionWrapper);
  });

  test("Should not roll back a transaction SQL Server already aborted", async () => {
    const { transaction, events } = FakeTransaction();
    const deadlock = Object.assign(new Error("Transaction was deadlocked"), { number: 1205 });

    const run = async () => {
      await using tx = new TransactionWrapper(transaction);
      // mssql flags the original transaction object when the server rolls it back
      (transaction as unknown as { _aborted: boolean })._aborted = true;
      throw deadlock;
    };

    // The deadlock surfaces as-is, not wrapped in a SuppressedError by a failed rollback
    await expect(run()).rejects.toBe(deadlock);
    expect(events).toEqual([]);
  });
});

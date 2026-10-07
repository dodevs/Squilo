import { expect, describe, test } from "bun:test";
import { ConnectionPool } from "mssql";
import { CONFIG, UseSqlServer } from "./container/container";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers } from "./container/setup/users";
import { ConnectionPoolWrapper } from "../src/pool";

describe('ConnectionPoolWrapper and TransactionWrapper', () => {
  const sql = UseSqlServer(async (container) => {
    await SetupDatabases(container);
    await SetupUsers(container);
  });

  test('ConnectionPoolWrapper should be disposable', async () => {
    const database = DATABASES[0];
    const conn = new ConnectionPool({ ...CONFIG(sql.container), database });
    await conn.connect();
    
    let isClosed = false;
    const originalClose = conn.close.bind(conn);
    conn.close = async () => {
        isClosed = true;
        return await originalClose();
    };

    {
        await using wrapped = new ConnectionPoolWrapper(conn);
        expect(wrapped).toBeDefined();
        expect(isClosed).toBe(false);
        // Verify we can run a query
        const result = await wrapped.query('SELECT 1 as one');
        expect(result.recordset[0].one).toBe(1);
    }

    // After the block, it should be closed
    expect(isClosed).toBe(true);
  });

  test('TransactionWrapper should rollback if not committed', async () => {
    const database = DATABASES[1]; // Use a different database to avoid conflicts
    const conn = new ConnectionPool({ ...CONFIG(sql.container), database });
    await conn.connect();

    const testEmail = "rollback-test@example.com";

    {
        await using wrappedPool = new ConnectionPoolWrapper(conn);
        
        {
            await using transaction = await wrappedPool.transaction$();
            const request = transaction.request();
            await request.query(`INSERT INTO Users (Name, Email) VALUES ('Test User', '${testEmail}')`);
        }

        const result = await wrappedPool.request().query(`SELECT * FROM Users WHERE Email = '${testEmail}'`);
        expect(result.recordset).toHaveLength(0);
    }
  });

  test('TransactionWrapper should commit if commit() is called', async () => {
    const database = DATABASES[2];
    const conn = new ConnectionPool({ ...CONFIG(sql.container), database });
    await conn.connect();

    const testEmail = "commit-test@example.com";
    
    {
        await using wrappedPool = new ConnectionPoolWrapper(conn);
        
        {
            await using transaction = await wrappedPool.transaction$();
            
            const request = transaction.request();
            await request.query(`INSERT INTO Users (Name, Email) VALUES ('Test User', '${testEmail}')`);
            
            await transaction.commit$();
        }

        const result = await wrappedPool.request().query(`SELECT * FROM Users WHERE Email = '${testEmail}'`);
        expect(result.recordset).toHaveLength(1);
        expect(result.recordset[0].Email).toBe(testEmail);
    }
  });

  test('TransactionWrapper should surface a deadlock as-is (no SuppressedError from a failed rollback)', async () => {
    const database = DATABASES[3];
    const setup = new ConnectionPool({ ...CONFIG(sql.container), database });
    await setup.connect();
    await setup.query(`
      CREATE TABLE DeadlockA (Id INT PRIMARY KEY, V INT); INSERT INTO DeadlockA VALUES (1, 0);
      CREATE TABLE DeadlockB (Id INT PRIMARY KEY, V INT); INSERT INTO DeadlockB VALUES (1, 0);
    `);
    await setup.close();

    // Each side locks one table, then waits for the other: SQL Server picks a victim and rolls it back.
    const lockInOrder = async (first: string, second: string) => {
      const conn = new ConnectionPool({ ...CONFIG(sql.container), database });
      await conn.connect();
      await using wrappedPool = new ConnectionPoolWrapper(conn);
      await using transaction = await wrappedPool.transaction$();
      await transaction.request().query(`UPDATE ${first} SET V = 1 WHERE Id = 1`);
      await new Promise((resolve) => setTimeout(resolve, 500));
      await transaction.request().query(`UPDATE ${second} SET V = 1 WHERE Id = 1`);
      await transaction.commit$();
    };

    const results = await Promise.allSettled([
      lockInOrder('DeadlockA', 'DeadlockB'),
      lockInOrder('DeadlockB', 'DeadlockA'),
    ]);

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason.name).not.toBe('SuppressedError');
    expect(rejected[0]!.reason.number).toBe(1205);
  });
});

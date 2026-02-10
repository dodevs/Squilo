import { expect, beforeAll, describe, test } from "bun:test";
import { ConnectionPool } from "mssql";
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers } from "./container/setup/users";
import { ConnectionPoolWrapper } from "../src/pool";

describe('ConnectionPoolWrapper and TransactionWrapper', async () => {
  const container = await AzureSqlEdge();
  const config = {
    server: container.getHost(),
    port: container.getMappedPort(1433),
    user: 'sa',
    password: SQL_PASSWORD,
    options: {
      encrypt: false,
      trustServerCertificate: true
    },
  };

  beforeAll(async () => {
    await SetupDatabases(container);
    await SetupUsers(container);
  })

  test('ConnectionPoolWrapper should be disposable', async () => {
    const database = DATABASES[0];
    const conn = new ConnectionPool({ ...config, database });
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
        const result = await wrapped.request().query('SELECT 1 as one');
        expect(result.recordset[0].one).toBe(1);
    }

    // After the block, it should be closed
    expect(isClosed).toBe(true);
  });

  test('TransactionWrapper should rollback if not committed', async () => {
    const database = DATABASES[1]; // Use a different database to avoid conflicts
    const conn = new ConnectionPool({ ...config, database });
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
    const conn = new ConnectionPool({ ...config, database });
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
});

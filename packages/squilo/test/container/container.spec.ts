import { describe, expect, it } from 'bun:test'
import { ConnectionPool } from 'mssql'
import { CONFIG, UseSqlServer } from './container';

describe('SQL Server', () => {
    const sql = UseSqlServer();

    it('should connect to the database', async () => {
        const conn = await new ConnectionPool({ ...CONFIG(sql.container), database: 'master' }).connect();
        const result = await conn.query`SELECT 'Hello'`;
        expect(result.recordset[0]['']).toBe('Hello');
        await conn.close();
    })
})

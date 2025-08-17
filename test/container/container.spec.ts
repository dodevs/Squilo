import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test'
import { connect, ConnectionPool } from 'mssql'
import type { StartedTestContainer } from 'testcontainers'
import { AzureSqlEdge, SQL_PASSWORD } from './container';

describe('SQL Server', async () => {
    let container: StartedTestContainer
    let sqlClient: ConnectionPool

    beforeAll(async () => {
        container = await AzureSqlEdge()
        sqlClient = await connect({
            server: container.getHost(),
            port: container.getMappedPort(1433),
            database: 'master',
            user: 'sa',
            password: SQL_PASSWORD,
            options: {
                encrypt: false
            }
        });
    })

    afterAll(async () => {
        await sqlClient.close();
        await container.stop();
    })

    it('should connect to the database', async () => {
        const result = await sqlClient.query`SELECT 'Hello'`;
        expect(result.recordset[0]['']).toBe('Hello');
    })
})
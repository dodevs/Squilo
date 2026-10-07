import { describe, expect, it } from "bun:test"
import { ConnectionPool } from "mssql"
import { SetupDatabases } from "./databases"
import { CONFIG, UseSqlServer } from "../container"

describe('Database creation', () => {
    const sql = UseSqlServer(SetupDatabases);

    it('Should create 5 databases', async () => {
        const conn = await new ConnectionPool({
            ...CONFIG(sql.container),
            database: "master"
        }).connect();

        const result = await conn.query`SELECT * FROM sys.databases WHERE name like 'TestDB%'`
        expect(result.recordset).toHaveLength(5);

        await conn.close();
    })
})

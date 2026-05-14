import { beforeAll, describe, expect, it } from "bun:test"
import { SetupDatabases } from "./databases"
import { AzureSqlEdge, CONFIG } from "../container"
import { connect } from "mssql"

describe('Database creation', async () => {
    const container = await AzureSqlEdge();

    beforeAll(async () => {
        await SetupDatabases(container);
    })

    it('Should create 5 databases', async () => {
        const conn = await connect({
            ...CONFIG(container),
            database: "master"
        });

        const result = await conn.query`SELECT * FROM sys.databases WHERE name like 'TestDB%'`
        expect(result.recordset).toHaveLength(5);

        await conn.close();
    })
})
import { beforeAll, describe, expect, test } from "bun:test";
import { AzureSqlEdge, CONFIG } from "../container";
import { DATABASES, SetupDatabases } from "./databases";
import { SetupUsers } from "./users";
import { connect } from "mssql";

describe('Users table', async () => {
    const container = await AzureSqlEdge();

    beforeAll(async () => {
        await SetupDatabases(container);
        await SetupUsers(container);
    })

    test.each(DATABASES)('Should create 10 users in %s', async (database) => {
        const conn = await connect({
            ...CONFIG(container),
            database
        });
        const result = await conn.query`SELECT * FROM Users`
        expect(result.recordset).toHaveLength(10);

        await conn.close();
    })
})
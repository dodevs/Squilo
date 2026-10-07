import { describe, expect, test } from "bun:test";
import { ConnectionPool } from "mssql";
import { CONFIG, UseSqlServer } from "../container";
import { DATABASES, SetupDatabases } from "./databases";
import { SetupUsers } from "./users";

describe('Users table', () => {
    const sql = UseSqlServer(async (container) => {
        await SetupDatabases(container);
        await SetupUsers(container);
    });

    test.each(DATABASES)('Should create 10 users in %s', async (database) => {
        const conn = await new ConnectionPool({
            ...CONFIG(sql.container),
            database
        }).connect();
        const result = await conn.query`SELECT * FROM Users`
        expect(result.recordset).toHaveLength(10);

        await conn.close();
    })
})

import { connect } from "mssql";
import { CONFIG } from "../container";
import type { StartedTestContainer } from "testcontainers";

export const DATABASES = [
    "TestDB1",
    "TestDB2",
    "TestDB3",
    "TestDB4",
    "TestDB5"
];

export const SetupDatabases = async (container: StartedTestContainer) => {
    const conn = await connect({
        ...CONFIG(container),
        database: "master"
    });
    for (const dbName of DATABASES) {
        await conn.query(`
            IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = '${dbName}')
            BEGIN
                CREATE DATABASE ${dbName};
            END
        `);
    }
    
    await conn.close();
}
import { Bit, connect, NVarChar, Table } from "mssql";
import { CONFIG } from "../container";
import type { StartedTestContainer } from "testcontainers";

export const CLIENTS_MANAGER_DATABASE = 'ClientsManager' as const;

export const DATABASES: string[] = [
    "TestDB1",
    "TestDB2",
    "TestDB3",
    "TestDB4",
    "TestDB5",
];

export const SetupClientManager = async (container: StartedTestContainer): Promise<void> => {
    const masterConn = await connect({
        ...CONFIG(container),
        database: "master"
    });

    await masterConn.query(`
        IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = '${CLIENTS_MANAGER_DATABASE}')
        BEGIN
            CREATE DATABASE ${CLIENTS_MANAGER_DATABASE};
        END
    `);

    await masterConn.close();

    const clientManagerConn = await connect({
        ...CONFIG(container),
        database: CLIENTS_MANAGER_DATABASE
    });

    await clientManagerConn.query(`
        IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Clients')
        BEGIN
            CREATE TABLE Clients (
                Id INT PRIMARY KEY IDENTITY(1,1),
                Name NVARCHAR(255) UNIQUE NOT NULL,
                DatabaseName NVARCHAR(255) UNIQUE NOT NULL,
                Active BIT NOT NULL
            );
        END
    `);

    const table = new Table("Clients");
    table.columns.add("Name", NVarChar(255), { nullable: false });
    table.columns.add("DatabaseName", NVarChar(255), { nullable: false });
    table.columns.add("Active", Bit(), { nullable: false });

    for (const database of DATABASES) {
        table.rows.add(database, database, 1);
    }
    table.rows.add("TestDB6", "TestDB6", 0);

    await clientManagerConn.request().bulk(table);
    await clientManagerConn.close();
}

export const SetupDatabases = async (container: StartedTestContainer): Promise<void> => {
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
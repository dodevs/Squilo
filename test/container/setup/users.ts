import { DATABASES } from "./databases";
import { connect, NVarChar, Table } from "mssql";
import { CONFIG } from "../container";
import { faker } from "@faker-js/faker";
import type { StartedTestContainer } from "testcontainers";

export type User = {
  Id: number;
  Name: string;
  Email: string;
};

export const SetupUsers = async (container: StartedTestContainer, options: {
  populate: boolean;
  quantity: number;
} = { 
  populate: true,
  quantity: 10
}): Promise<void> => {
  for (const database of DATABASES) {
    const conn = await connect({
      ...CONFIG(container),
      database
    });

    await conn.request().query`
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'Users')
      BEGIN
        CREATE TABLE Users (
          Id INT PRIMARY KEY IDENTITY(1,1),
          Name NVARCHAR(100) NOT NULL,
          Email NVARCHAR(100) NOT NULL
        );
      END

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_Name' AND object_id = OBJECT_ID('Users'))
      BEGIN
        CREATE INDEX IX_Users_Name ON Users (Name);
      END

      IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_Users_Email' AND object_id = OBJECT_ID('Users'))
      BEGIN
        CREATE INDEX IX_Users_Email ON Users (Email);
      END
    `;

    if (options.populate) {
      await conn.request().query(`DELETE FROM Users`);

      const usersTable = new Table("Users");
      usersTable.columns.add("Name", NVarChar(100), { nullable: false });
      usersTable.columns.add("Email", NVarChar(100), { nullable: false });

      faker.seed(123);
    
      for (let i = 0; i < options.quantity; i++) {
        const name = faker.person.fullName();
        const email = faker.internet.email();

        usersTable.rows.add(name, email);
      }

      await conn.request().bulk(usersTable);
    }
    
    await conn.close();
  }
}
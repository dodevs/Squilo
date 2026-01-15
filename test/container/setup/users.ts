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
} = { 
  populate: true 
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
    `;

    if (options.populate) {
      await conn.request().query(`DELETE FROM Users`);

      const usersTable = new Table("Users");
      usersTable.columns.add("Name", NVarChar(100), { nullable: false });
      usersTable.columns.add("Email", NVarChar(100), { nullable: false });
    
      for (let i = 0; i < 10; i++) {
        const name = faker.person.fullName({ firstName: "Joe"});
        const email = faker.internet.email({ firstName: "Joe" }) + " ";

        usersTable.rows.add(name, email);
      }

      await conn.request().bulk(usersTable);
    }
    
    await conn.close();
  }
}
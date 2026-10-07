import { expect, describe, it, test } from "bun:test";
import { MergeOutputStrategy } from "../src/pipes/output/strategies";
import { UseSqlServer } from "./container/container";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers, type User } from "./container/setup/users";

describe('Squilo test', () => {
  const sql = UseSqlServer(async (container) => {
    await SetupDatabases(container);
    await SetupUsers(container);
  });

  it("Get one from each database", async () => {

    const [, users] = await sql.server
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<User>`
            SELECT TOP 1 * FROM Users
        `;

        return result.recordset;
      })
      .Output(MergeOutputStrategy());

    expect(users).toHaveLength(5);
  });

  test('Should fix user\'s email that are ending with extra space', async () => {
    await sql.server
      .Connect(DATABASES)
      .Execute(async (conn) => {
        await conn.query`
            UPDATE Users SET Email = RTRIM(Email)
        `;
      })

    const [, users] = await sql.server
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<User>`
            SELECT * FROM Users
          `;

        return result.recordset;
      })
      .Output(MergeOutputStrategy());

    expect(users.every((user) => user.Email.endsWith(" ") === false)).toBe(true);
  })

  test('Should commit or roll back a transaction inside Execute', async () => {
    const insert = (email: string, commit: boolean) => sql.server
      .Connect(DATABASES)
      .Execute(async (conn) => {
        await using tx = await conn.transaction$();
        await tx.request().query`INSERT INTO Users (Name, Email) VALUES ('Transaction', ${email})`;
        if (commit) await tx.commit$();
      });

    expect(await insert("committed@test.com", true)).toEqual([]);
    expect(await insert("rolled-back@test.com", false)).toEqual([]);

    const [, emails] = await sql.server
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<{ Email: string }>`
            SELECT Email FROM Users WHERE Name = 'Transaction'
          `;

        return result.recordset.map((user) => user.Email);
      })
      .Output(MergeOutputStrategy());

    expect(emails).toEqual(DATABASES.map(() => "committed@test.com"));
  })
});

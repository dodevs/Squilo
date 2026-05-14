import { expect, beforeAll, describe, it, afterAll, test } from "bun:test";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { MergeOutputStrategy } from "../src/pipes/output/strategies";
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers, type User } from "./container/setup/users";

describe('Squilo test', async () => {
  const container = await AzureSqlEdge();

  const LocalServer = Server({
    server: container.getHost(),
    port: container.getMappedPort(1433),
    options: {
      encrypt: false
    },
  })
    .Auth(UserAndPassword("sa", SQL_PASSWORD));

  beforeAll(async () => {
    await SetupDatabases(container);
    await SetupUsers(container);
  })

  it("Get one from each database", async () => {

    const [, users] = await LocalServer
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
    await LocalServer
      .Connect(DATABASES)
      .Execute(async (conn) => {
        await conn.query`
            UPDATE Users SET Email = RTRIM(Email)
        `;
      })

    const [, users] = await LocalServer
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
});

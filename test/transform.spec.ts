import { expect, describe, it, beforeAll, afterAll } from "bun:test";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { MergeOutputStrategy } from "../src/pipes/output/strategies";
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers, type User } from "./container/setup/users";

describe('Transform pipe test', async () => {
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

  it("Should transform user data to uppercase emails", async () => {
    const [, transformedUsers] = await LocalServer
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        try {
          const result = await conn.query<User>`
            SELECT TOP 2 * FROM Users
          `;

          return result.recordset;
        } catch (error) {
          console.error("Error querying users:", error);
          return [];
        }
      })
      .Transform((users) => {
        // Transform function that converts emails to uppercase
        return users.map(user => ({
          ...user,
          Email: user.Email.toUpperCase()
        }));
      })
      .Output(MergeOutputStrategy());

    expect(transformedUsers).toHaveLength(10); // 2 users * 5 databases
    expect(transformedUsers.every((user) => user.Email === user.Email.toUpperCase())).toBe(true);
  });

  it("Should transform single values", async () => {
    const [, userCount] = await LocalServer
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<{ count: number }>`
            SELECT COUNT(*) as count FROM Users
        `;

        return result.recordset[0]?.count || 0;
      })
      .Transform((count) => {
        // Transform function that doubles the count
        return count * 2;
      })
      .Output(MergeOutputStrategy());

    expect(userCount).toHaveLength(5); // 5 databases
    expect(userCount.every((count) => count % 2 === 0)).toBe(true); // All counts should be doubled (even)
  });

  it("Should add new property to user data", async () => {
    const [, transformedUsers] = await LocalServer
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<User>`
            SELECT TOP 2 * FROM Users
        `;

        return result.recordset;
      })
      .Transform((users) => {
        // Transform function that converts emails to uppercase
        return users.map(user => ({
          ...user,
          NameWithId: `${user.Name} (${user.Id})`
        }));
      })
      .Output(MergeOutputStrategy());

    expect(transformedUsers).toHaveLength(10);
    expect(transformedUsers.every((user) => user.NameWithId === `${user.Name} (${user.Id})`)).toBe(true);
  });

  it("Should work with async transform", async () => {
    const [, transformedUsers] = await LocalServer
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<User>`
            SELECT TOP 2 * FROM Users
        `;

        return result.recordset;
      })
      .Transform(async (users) => {
        // Simulate async operation like external API call
        await new Promise(resolve => setTimeout(resolve, 10));
        return users.map(user => ({
          ...user,
          Email: user.Email.toUpperCase()
        }));
      })
      .Output(MergeOutputStrategy());

    expect(transformedUsers).toHaveLength(10); // 2 users * 5 databases
    expect(transformedUsers.every((user) => user.Email === user.Email.toUpperCase())).toBe(true);
  })

  it("Should work without Transform (existing functionality)", async () => {
    const [, users] = await LocalServer
      .Connect(DATABASES)
      .Retrieve(async (conn) => {
        const result = await conn.query<User>`
            SELECT TOP 1 * FROM Users
        `;

        return result.recordset;
      })
      .Output(MergeOutputStrategy());

    expect(users).toHaveLength(5); // 1 user * 5 databases
  });
});
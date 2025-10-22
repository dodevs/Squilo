import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";
import { Server } from "../src/pipes/server";
import { UserAndPassword } from "../src/pipes/auth/strategies";
import { DATABASES, SetupDatabases } from "./container/setup/databases";
import { SetupUsers, type User } from "./container/setup/users";
import { MergeOutputStrategy } from "../src/pipes/output/strategies";

describe('Squilo input test', async () => {
    const container = await AzureSqlEdge();
    const localServer = Server({
        server: container.getHost(),
        port: container.getMappedPort(1433),
        options: {
            encrypt: false
        },
    })
    .Auth(UserAndPassword("sa", SQL_PASSWORD));

    beforeAll(async () => {
        await SetupDatabases(container);
        await SetupUsers(container, { populate: false })
    })

    afterAll(async () => {
        await localServer.Close();
    })

    test('Should add a user using input', async () => {
        let name: string | null = "joe";
        let email: string | null = "joe.doe@example.com";

        // Execute the insert operation and store the promise
        const executePromise = localServer
            .Connect(DATABASES)
            .Input<Omit<User, "Id">>(() => {
                return {
                    Name: name!,
                    Email: email!,
                }
            })
            .Execute(async (transaction, _, user) => {
                await transaction.request().query`
                    INSERT INTO Users (Name, Email)
                    VALUES (${user.Name}, ${user.Email})
                `;
            });
            
        // Wait for the execute operation to complete before retrieving
        await executePromise;

        const users = await localServer
            .Connect(DATABASES)
            .Retrieve(async (transaction) => {
                const result = await transaction.request().query<User>`
                    SELECT * FROM Users
                `;

                return result.recordset;
            })
            .Output(MergeOutputStrategy());

        expect(users).toHaveLength(5);
        
        const everyUserIsJoe = users.every(user => user.Name === name && user.Email === email);
        expect(everyUserIsJoe).toBe(true);
    })
})
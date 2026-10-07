import { afterAll, beforeAll } from "bun:test";
import { type config, ConnectionPool } from "mssql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { Server } from "../../src/pipes/server";
import { UserAndPassword } from "../../src/pipes/auth/strategies";
import type { AuthenticationChain } from "../../src/pipes/auth/types";

export const SQL_PASSWORD = "YourStrong@Passw0rd";

/** Hook budget for starting SQL Server and seeding it. bunfig's `timeout` only applies to tests, not hooks. */
export const SQL_SERVER_TIMEOUT = 180_000;

export const CONFIG = (container: StartedTestContainer): config => ({
    server: container.getHost(),
    port: container.getMappedPort(1433),
    user: "sa",
    password: SQL_PASSWORD,
    options: {
        encrypt: false
    }
})

// "Recovery is complete" is logged before SQL Server accepts logins ("Login failed for user 'sa'").
const WaitForLogin = async (container: StartedTestContainer): Promise<void> => {
    const deadline = Date.now() + 60_000;

    for (;;) {
        try {
            const conn = await new ConnectionPool({ ...CONFIG(container), database: "master" }).connect();
            await conn.close();
            return;
        } catch (error) {
            if (Date.now() > deadline) {
                throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

export const AzureSqlEdge = async (): Promise<StartedTestContainer> => {
    const container = await new GenericContainer('mcr.microsoft.com/azure-sql-edge')
        .withEnvironment({
            'ACCEPT_EULA': 'Y',
            'MSSQL_SA_PASSWORD': SQL_PASSWORD
        })
        .withExposedPorts(1433)
        .withWaitStrategy(Wait.forLogMessage('Recovery is complete'))
        .start();

    await WaitForLogin(container);
    return container;
}

export type SqlServer = {
    readonly container: StartedTestContainer;
    /** `Server(...).Auth(UserAndPassword("sa", ...))` for this container, created once. */
    readonly server: AuthenticationChain;
}

/**
 * Starts a SQL Server for the enclosing `describe` block, runs `setup` against it, and stops it after the
 * block. Stopping matters: containers left running pile up across spec files and slow later ones down.
 */
export const UseSqlServer = (setup?: (container: StartedTestContainer) => Promise<void>): SqlServer => {
    let container: StartedTestContainer | undefined;
    let server: AuthenticationChain | undefined;

    beforeAll(async () => {
        container = await AzureSqlEdge();
        await setup?.(container);
    }, SQL_SERVER_TIMEOUT);

    afterAll(async () => {
        await container?.stop();
    }, SQL_SERVER_TIMEOUT);

    return {
        get container() {
            if (!container) {
                throw new Error("SQL Server is not started yet: use it inside tests or hooks");
            }
            return container;
        },
        get server() {
            server ??= Server({
                server: this.container.getHost(),
                port: this.container.getMappedPort(1433),
                options: {
                    encrypt: false
                },
            }).Auth(UserAndPassword("sa", SQL_PASSWORD));
            return server;
        },
    };
}

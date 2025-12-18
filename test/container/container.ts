import type { config } from "mssql";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";

export const SQL_PASSWORD = "YourStrong@Passw0rd";

export const AzureSqlEdge = (): Promise<StartedTestContainer> => new GenericContainer('mcr.microsoft.com/azure-sql-edge')
    .withEnvironment({
        'ACCEPT_EULA': 'Y',
        'MSSQL_SA_PASSWORD': SQL_PASSWORD
    })
    .withExposedPorts(1433)
    .withWaitStrategy(Wait.forLogMessage('Recovery is complete'))
    .start();

export const CONFIG = (container: StartedTestContainer): config => ({
    server: container.getHost(),
    port: container.getMappedPort(1433),
    user: "sa",
    password: SQL_PASSWORD,
    options: {
        encrypt: false
    }
})
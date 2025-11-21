import { beforeAll, describe, expect, test, mock, afterEach, afterAll } from 'bun:test'
import { AzureSqlEdge, SQL_PASSWORD } from './container/container'
import { Server } from '../src';
import { UserAndPassword } from '../src/pipes/auth/strategies';
import { CLIENTS_MANAGER_DATABASE, DATABASES, SetupClientManager, SetupDatabases } from './container/setup/databases';
import type { DatabaseConnection } from '../src/pipes/connect/types';
import type { Transaction } from 'mssql';

const mockExecute = mock(<TParam>(connections$: (databases: string[]) => Generator<DatabaseConnection[]>, databases$: Promise<string[]>) => (fn: (transaction: Transaction, database: string, params: TParam) => Promise<void>) => Promise<void>);
mock.module('../src/pipes/execute', () => ({
    Execute: mockExecute,
}))

describe('Connection overloads', async () => {
    const container = await AzureSqlEdge();
    const LocalServer = Server({
        server: container.getHost(),
        port: container.getMappedPort(1433),
        options: {
            encrypt: false
        }
    }).Auth(UserAndPassword("sa", SQL_PASSWORD));

    beforeAll(async () => {
        await SetupDatabases(container);
        await SetupClientManager(container);
    });

    afterAll(async () => {
        await LocalServer.Close();
    })

    afterEach(() => {
        mockExecute.mockClear();
    })

    test('Connect to unique database', async () => {
        const database = DATABASES[0]!;
        const Connection = LocalServer.Connect(database);

        expect(Connection).toBeDefined();
        expect(mockExecute).toHaveBeenCalledTimes(1);
        const connectionsFn = mockExecute.mock.calls[0]![0];
        const connectionsGenerator = connectionsFn([database]);
        const uniqueConnection = await connectionsGenerator.next();

        expect(uniqueConnection.done).toBe(false);
        expect(uniqueConnection.value).toHaveLength(1);
        expect(uniqueConnection.value).toEqual([{
            database,
            connection: expect.any(Promise),
        }]);
    });

    test('Connect with database list', async () => {
        const databases = [DATABASES[0]!, DATABASES[1]!];
        LocalServer.Connect(databases);

        expect(mockExecute).toHaveBeenCalledTimes(1);
        const connectionsFn = mockExecute.mock.calls[0]![0];
        const connectionsGenerator = connectionsFn(databases);
        const connections = await connectionsGenerator.next();

        expect(connections.done).toBe(false);
        expect(connections.value).toHaveLength(2);
        expect(connections.value).toEqual([{
            database: DATABASES[0]!,
            connection: expect.any(Promise),
        }, {
            database: DATABASES[1]!,
            connection: expect.any(Promise),
        }]);
    });

    test('Connect with limited concurrent database list', async () => {
        const databases = [DATABASES[0]!, DATABASES[1]!, DATABASES[2]!, DATABASES[3]!];
        LocalServer.Connect(databases, 2);

        expect(mockExecute).toHaveBeenCalledTimes(1);
        const connectionsFn = mockExecute.mock.calls[0]![0];
        const connectionsGenerator = connectionsFn(databases);
        const firstConnections = await connectionsGenerator.next();

        expect(firstConnections.done).toBe(false);
        expect(firstConnections.value).toHaveLength(2);
        expect(firstConnections.value).toEqual([{
            database: DATABASES[0],
            connection: expect.any(Promise),
        }, {
            database: DATABASES[1],
            connection: expect.any(Promise),
        }]);

        const secondConnections = await connectionsGenerator.next();
        expect(secondConnections.done).toBe(false);
        expect(secondConnections.value).toHaveLength(2);
        expect(secondConnections.value).toEqual([{
            database: DATABASES[2],
            connection: expect.any(Promise),
        }, {
            database: DATABASES[3],
            connection: expect.any(Promise),
        }]);

        const thirdConnections = await connectionsGenerator.next();
        expect(thirdConnections.done).toBe(true);
    });

    test('Connect with query', async () => {
        LocalServer.Connect({
            database: CLIENTS_MANAGER_DATABASE,
            query: 'SELECT DatabaseName FROM Clients WHERE Active = 1'
        });

        expect(mockExecute).toHaveBeenCalledTimes(1);
        const connectionsFn = mockExecute.mock.calls[0]![0];
        const databases$ = mockExecute.mock.calls[0]![1];
        const connectionsGenerator = connectionsFn(await databases$);
        const connections = await connectionsGenerator.next();
        expect(connections.done).toBe(false);
        expect(connections.value).toHaveLength(5);
        expect(connections.value).toEqual(DATABASES.map(database => ({
            database,
            connection: expect.any(Promise),
        })));
    })
})
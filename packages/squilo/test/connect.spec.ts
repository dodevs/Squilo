import { beforeAll, describe, expect, test, afterAll } from 'bun:test'
import { UseSqlServer } from './container/container'
import { CLIENTS_MANAGER_DATABASE, DATABASES, SetupClientManager, SetupDatabases } from './container/setup/databases';
import { MergeOutputStrategy } from '../src/pipes/output/strategies';
import type { ConnectionPoolWrapper } from '../src/pool';

describe('Connection overloads', () => {
    const sql = UseSqlServer(async (container) => {
        await SetupDatabases(container);
        await SetupClientManager(container);
    });

    const currentDatabase = async (conn: ConnectionPoolWrapper) => {
        const result = await conn.query<{ name: string }>('SELECT DB_NAME() AS name');
        return [result.recordset[0]!.name];
    };

    let originalSafeGuard: string | undefined;

    beforeAll(async () => {
        originalSafeGuard = process.env.SAFE_GUARD;
        process.env.SAFE_GUARD = '0';
    });

    afterAll(async () => {
        if (originalSafeGuard) {
            process.env.SAFE_GUARD = originalSafeGuard;
        } else {
            delete process.env.SAFE_GUARD;
        }
    })

    test('Connect to unique database', async () => {
        const database = DATABASES[0]!;

        const [errors, names] = await sql.server
            .Connect(database)
            .Retrieve(currentDatabase)
            .Output(MergeOutputStrategy());

        expect(errors).toEqual([]);
        expect(names).toEqual([database]);
    });

    test('Connect with database list', async () => {
        const databases = [DATABASES[0]!, DATABASES[1]!];

        const [errors, names] = await sql.server
            .Connect(databases)
            .Retrieve(currentDatabase)
            .Output(MergeOutputStrategy());

        expect(errors).toEqual([]);
        expect(names.sort()).toEqual([...databases].sort());
    });

    test('Connect with limited concurrent database list', async () => {
        const databases = [DATABASES[0]!, DATABASES[1]!, DATABASES[2]!, DATABASES[3]!];
        let inFlight = 0;
        let maxInFlight = 0;

        const [errors, names] = await sql.server
            .Connect(databases, 2)
            .Retrieve(async (conn) => {
                maxInFlight = Math.max(maxInFlight, ++inFlight);
                try {
                    await conn.query("WAITFOR DELAY '00:00:00.200'");
                    return await currentDatabase(conn);
                } finally {
                    inFlight--;
                }
            })
            .Output(MergeOutputStrategy());

        expect(errors).toEqual([]);
        expect(names.sort()).toEqual([...databases].sort());
        expect(maxInFlight).toBe(2);
    });

    test('Connect with query', async () => {
        const [errors, databases] = await sql.server
            .Connect<{ Database: string }>({
                database: CLIENTS_MANAGER_DATABASE,
                query: 'SELECT DatabaseName as [Database] FROM Clients WHERE Active = 1'
            })
            .Retrieve(async (_, database) => [database])
            .Output(MergeOutputStrategy());

        expect(errors).toEqual([]);
        expect(databases.map(d => d.Database).sort()).toEqual([...DATABASES].sort());
    })
})

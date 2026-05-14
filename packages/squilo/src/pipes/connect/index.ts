import type { Pool } from "../../pool";
import { Execute } from "../execute";
import { Retrieve } from "../retrieve";

import type { ConnectionOptions, ConnectionChain, DatabaseConnection, DatabaseObject } from "./types";
import { LoadEnv } from "../../utils/load-env";

export const Connect = (pool: Pool) => <T extends string | DatabaseObject>(param: string | string[] | ConnectionOptions, concurrent?: number): ConnectionChain<T> => {
    let databases$: Promise<T[]>;

    function connections(concurrent: number = Number.MAX_VALUE): (databases: T[]) => Generator<DatabaseConnection<T>[]> {
        const safe_guard = LoadEnv().SAFE_GUARD;

        const mapDatabase = (database: T) => ({
            database,
            connection: pool.connect({ database: typeof database === 'string' ? database : database.Database })
        });

        return function* (databases: T[]) {
            let i = 0;
            const len = databases.length;
            const firstChunkLimit = Math.min(len, concurrent);
            const safeguardLimit = Math.min(firstChunkLimit, safe_guard || 0);

            while (i < safeguardLimit) {
                yield [mapDatabase(databases[i++] as T)];
            }

            if (i < firstChunkLimit) {
                yield databases.slice(i, firstChunkLimit).map(mapDatabase);
                i = firstChunkLimit;
            }

            while (i < len) {
                const end = Math.min(i + concurrent, len);
                yield databases.slice(i, end).map(mapDatabase);
                i = end;
            }
        }
    }

    if (typeof param === 'string') {
        databases$ = Promise.resolve([param as T]);
    }

    else if (Array.isArray(param)) {
        databases$ = Promise.resolve(param as T[]);
    }

    else if (typeof param === 'object' && 'query' in param) {
        databases$ = pool
            .connect({ database: param.database })()
            .then(conn => conn
                .request()
                .query<T[]>(param.query)
            )
            .then(result => result.recordset)
    }

    else {
        throw new Error("Invalid parameter");
    }

    const connections$ = connections(concurrent);

    return {
        Execute: Execute(connections$, databases$),
        Retrieve: Retrieve(connections$, databases$)
    }
}
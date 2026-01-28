import type { Pool } from "../../pool";
import { Execute } from "../execute";
import { Retrieve } from "../retrieve";

import type { ConnectionOptions, ConnectionChain, DatabaseConnection, DatabaseObject } from "./types";
import { LoadEnv } from "../../utils/load-env";

export const Connect = (pool: Pool) => <T extends string | DatabaseObject>(param: string | string[] | ConnectionOptions, concurrent?: number): ConnectionChain<T> => {
    let databases$: Promise<T[]>;

    function connections(concurrent: number = Number.MAX_VALUE): (databases: T[]) => Generator<DatabaseConnection<T>[]> {
        return function* (databases: T[]) {
            const _databases = [...databases];
            const safe_guard = LoadEnv().SAFE_GUARD;

            if (safe_guard > 0) {
                const guard_test = _databases.splice(0, safe_guard);

                for (const database of guard_test) {
                    yield [{
                        database,
                        connection: pool.connect({ database: typeof database === 'string' ? database : database.Database })
                    }];
                }
            }

            const databases_result_chunks = Array.from(
                { length: Math.ceil(_databases.length / concurrent) },
                (_, i) => _databases.slice(i * concurrent, (i + 1) * concurrent)
            );

            for (const databases_result_chunk of databases_result_chunks) {
                yield databases_result_chunk.map(database => ({
                    database,
                    connection: pool.connect({ database: typeof database === 'string' ? database : database.Database })
                }));
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
            .connect({ database: param.database })
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
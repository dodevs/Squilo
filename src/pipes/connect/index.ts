import type { Pool } from "../../pool";
import { Input } from "../input";
import { Execute } from "../execute";
import { Retrieve } from "../retrieve";

import type { ConnectOverloads, ConnectionOptions, ConnectionChain, DatabaseConnection } from "./types";
import { LoadEnv } from "../../utils/load-env";

export const Connect = (pool: Pool): ConnectOverloads => (param: string | string[] | ConnectionOptions, concurrent?: number): ConnectionChain => {
    let connections$: (databases: string[]) => Generator<DatabaseConnection[]>;
    let databases$: Promise<string[]>;

    function connections(concurrent: number = Number.MAX_VALUE): (databases: string[]) => Generator<DatabaseConnection[]> {
        return function* (databases: string[]) {
            const _databases = [...databases];
            const safe_guard = LoadEnv().SAFE_GUARD;

            if (safe_guard > 0) {
                const guard_test = _databases.splice(0, safe_guard);

                for (const database of guard_test) {
                    yield [{
                        database,
                        connection: pool.connect({ database })
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
                    connection: pool.connect({ database })
                }));
            }
        }
    }

    if (typeof param === 'string') {
        databases$ = Promise.resolve([param]);
    }

    else if (Array.isArray(param)) {
        databases$ = Promise.resolve(param);
    }

    else if (typeof param === 'object' && 'query' in param) {
        databases$ = pool
            .connect({ database: param.database, arrayRowMode: true })
            .then(conn => conn
                .request()
                .query<string[]>(param.query)
            )
            .then(result => result.recordset.flat())
    }

    else {
        throw new Error("Invalid parameter");
    }

    connections$ = connections(concurrent);

    return {
        Input: Input(connections$, databases$),
        Execute: Execute(connections$, databases$, null),
        Retrieve: Retrieve(connections$, databases$, null)
    }
}
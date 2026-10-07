import { Effect } from "effect";
import type { Pool } from "../../pool";
import { Execute } from "../execute";
import { Retrieve } from "../retrieve";
import { Runner } from "../shared/runner";
import type { Databases } from "../shared/runner/types";

import type { ConnectionOptions, ConnectionChain, DatabaseObject } from "./types";

const ResolveDatabases = <T extends string | DatabaseObject>(
    pool: Pool,
    param: string | string[] | ConnectionOptions
): Databases<T> => {
    if (typeof param === "string") {
        return Effect.succeed([param as T]);
    }

    if (Array.isArray(param)) {
        return Effect.succeed(param as T[]);
    }

    if (typeof param === "object" && "query" in param) {
        return Effect.tryPromise({
            try: () => pool
                .connect({ database: param.database })()
                .then(conn => conn
                    .request()
                    .query<T>(param.query)
                )
                .then(result => result.recordset),
            catch: (error) => error,
        });
    }

    throw new Error("Invalid parameter");
}

export const Connect = (pool: Pool) => <T extends string | DatabaseObject>(param: string | string[] | ConnectionOptions, concurrent?: number): ConnectionChain<T> => {
    const run = Runner<T>(pool, ResolveDatabases<T>(pool, param), concurrent);

    return {
        Execute: Execute(run),
        Retrieve: Retrieve(run)
    }
}

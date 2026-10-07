import { Effect } from "effect";
import type { Pool } from "../../pool";
import { Execute } from "../execute";
import { Retrieve } from "../retrieve";
import { Runner } from "../shared/runner";
import type { Databases } from "../shared/runner/types";

import type { ConnectionOptions, ConnectionChain, DatabaseObject, ExecutionOptions } from "./types";

const resolveDatabases = <T extends string | DatabaseObject>(
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
        return Effect.acquireUseRelease(
            Effect.tryPromise({
                try: () => pool.connect({ database: param.database })(),
                catch: (error) => error,
            }),
            (conn) => Effect.tryPromise({
                try: () => conn.request().query<T>(param.query).then(result => result.recordset),
                catch: (error) => error,
            }),
            (conn) => Effect.promise(() => conn.close().catch(() => { })),
        );
    }

    throw new Error("Invalid parameter");
}

export const Connect = (pool: Pool) => <T extends string | DatabaseObject>(param: string | string[] | ConnectionOptions, options?: number | ExecutionOptions): ConnectionChain<T> => {
    const executionOptions = typeof options === "number" ? { concurrent: options } : options;
    const run = Runner<T>(pool, resolveDatabases<T>(pool, param), executionOptions);

    return {
        Execute: Execute(run),
        Retrieve: Retrieve(run)
    }
}

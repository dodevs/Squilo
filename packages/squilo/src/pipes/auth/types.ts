import type { ConnectionChain, ConnectionOptions, DatabaseObject, ExecutionOptions } from "../connect/types";

export type AuthenticationChain = {
    Connect(database: string, options?: ExecutionOptions): ConnectionChain<string>;
    Connect(databases: string[], options?: number | ExecutionOptions): ConnectionChain<string>;
    Connect<T extends DatabaseObject>(query: ConnectionOptions, options?: number | ExecutionOptions): ConnectionChain<T>;
}

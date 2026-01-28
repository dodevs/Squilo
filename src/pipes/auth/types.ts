import type { ConnectionChain, ConnectionOptions, DatabaseObject } from "../connect/types";

export type AuthenticationChain = {
    Connect(database: string): ConnectionChain<string>;
    Connect(databases: string[], concurrent?: number): ConnectionChain<string[]>;
    Connect<T extends DatabaseObject>(options: ConnectionOptions, concurrent?: number): ConnectionChain<T>;
    Close(): Promise<void>;
}
import type { ConnectionChain, ConnectionOptions } from "../connect/types";

export type AuthenticationChain = {
    Connect(database: string): ConnectionChain;
    Connect(databases: string[], concurrent?: number): ConnectionChain;
    Connect(options: ConnectionOptions, concurrent?: number): ConnectionChain;
    Close(): Promise<void>;
}
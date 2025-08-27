import type { config } from "mssql";
import type { ConnectionChain, ConnectionOptions } from "../connect/types";
import type { ServerConfig } from "../server/types";

export type AuthStrategy = (config: ServerConfig) => config;

export type AuthenticationChain = {
    Connect(database: string): ConnectionChain;
    Connect(databases: string[], concurrent?: number): ConnectionChain;
    Connect(options: ConnectionOptions, concurrent?: number): ConnectionChain;
    Close(): Promise<void>;
}
import type { config } from 'mssql';
import type { ServerConfig } from "../server/types";
import type { ConnectionOptions } from "../connect";
import { Pool } from "../../pool";
import { type ConnectionChain, Connect } from "../connect";

export type AuthStrategy = (config: ServerConfig) => config;

export type AuthenticationChain = {
    Connect(database: string): ConnectionChain;
    Connect(databases: string[], concurrent?: number): ConnectionChain;
    Connect(options: ConnectionOptions, concurrent?: number): ConnectionChain;
    Close(): Promise<void>;
}

export const Auth = (config: ServerConfig) => (strategy: AuthStrategy): AuthenticationChain => {
    const configWithAuth = strategy(config);
    const pool = Pool(configWithAuth);

    return {
        Connect: Connect(pool),
        Close: () => pool.closeAll(),
    }
}
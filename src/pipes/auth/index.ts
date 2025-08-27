import type { ServerConfig } from "../server/types";
import { Pool } from "../../pool";
import { Connect } from "../connect";
import type { AuthStrategy, AuthenticationChain } from "./types";

export const Auth = (config: ServerConfig) => (strategy: AuthStrategy): AuthenticationChain => {
    const configWithAuth = strategy(config);
    const pool = Pool(configWithAuth);

    return {
        Connect: Connect(pool),
        Close: () => pool.closeAll(),
    }
}
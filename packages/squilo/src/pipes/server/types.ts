import type { config } from "mssql";
import type { AuthenticationChain } from "../auth/types";
import type { AuthStrategy } from "../auth/strategies/types";

export type ServerConfig = Omit<config, "authentication" | "user" | "password">;

export type ServerChain = {
    Auth(strategy: AuthStrategy): AuthenticationChain;
}

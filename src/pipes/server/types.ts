import type { config } from "mssql";
import type { AuthStrategy, AuthenticationChain } from "../auth/types";

export type ServerConfig = Omit<config, "authentication" | "user" | "password">;

export type ServerChain = {
    Auth(strategy: AuthStrategy): AuthenticationChain;
}

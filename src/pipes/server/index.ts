import { type AuthStrategy, type AuthenticationChain, Auth } from "../auth";
import { ServerConfig } from "./types";

type ServerChain = {
    Auth(strategy: AuthStrategy): AuthenticationChain;
}

export const Server = (config: ServerConfig): ServerChain => ({
    Auth: Auth(config),
});
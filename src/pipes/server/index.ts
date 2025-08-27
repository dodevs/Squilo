import { Auth } from "../auth";
import type { ServerChain, ServerConfig } from "./types";

export const Server = (config: ServerConfig): ServerChain => ({
    Auth: Auth(config),
});
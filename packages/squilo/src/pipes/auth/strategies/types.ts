import type { ServerConfig } from "../../server/types";
import type { config } from "mssql";

export type AuthStrategy = (config: ServerConfig) => config;
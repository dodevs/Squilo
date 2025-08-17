import type { config } from "mssql";

export type ServerConfig = Omit<config, "authentication" | "user" | "password">;

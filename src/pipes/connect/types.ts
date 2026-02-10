import type { RetrieveChain } from "../retrieve/types";
import type { ExecutionError } from "../shared/runner/types";
import type { ConnectionPoolWrapper } from "../../pool";
import type { ConnectionPool } from "mssql";

export type DatabaseObject = object & {
    Database: string;
}

export type ConnectionOptions = {
    database: string;
    query: `SELECT ${string}[Database]${string} FROM ${string}`;
}

export type DatabaseConnection<T> = {
    database: T;
    connection: () => Promise<ConnectionPool>;
}

export type ConnectionChain<T> = {
    Execute(fn: (connection: ConnectionPoolWrapper) => Promise<void>): Promise<ExecutionError<T>[]>;
    Retrieve<TResult>(fn: (connection: ConnectionPoolWrapper) => Promise<TResult>): RetrieveChain<T, TResult>;
}
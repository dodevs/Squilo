import type { RetrieveChain } from "../retrieve/types";
import type { ExecutionError } from "../shared/runner/types";
import type { ConnectionPoolWrapper } from "../../pool";

export type DatabaseObject = object & {
    Database: string;
}

export type ConnectionOptions = {
    database: string;
    query: `SELECT ${string}[Database]${string} FROM ${string}`;
}

export type ConnectionChain<T> = {
    Execute(fn: (connection: ConnectionPoolWrapper, database: T) => Promise<void>): Promise<ExecutionError<T>[]>;
    Retrieve<TResult>(fn: (connection: ConnectionPoolWrapper, database: T) => Promise<TResult>): RetrieveChain<T, TResult>;
}
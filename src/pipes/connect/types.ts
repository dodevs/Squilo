import type { ConnectionPool, Transaction } from "mssql";
import type { RetrieveChain } from "../retrieve/types";
import type { ExecutionError } from "../shared/runner/types";

export type DatabaseObject = object & {
    Database: string;
}

export type ConnectionOptions = {
    database: string;
    query: `SELECT ${string}[Database]${string} FROM ${string}`;
}

export type DatabaseConnection<T> = {
    database: T;
    connection: Promise<ConnectionPool>;
}

export type ConnectionChain<T> = {
    Execute(fn: (transaction: Transaction, database: T) => Promise<void>): Promise<ExecutionError<T>[]>;
    Retrieve<TResult>(fn: (transaction: Transaction, database: T) => Promise<TResult>): RetrieveChain<T, TResult>;
}
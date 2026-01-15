import type { ConnectionPool, Transaction } from "mssql";
import type { RetrieveChain } from "../retrieve/types";
import type { ExecutionError } from "../shared/runner/types";


export type ConnectOverloads = {
    (database: string): ConnectionChain;
    (databases: string[], concurrent?: number): ConnectionChain;
    (options: ConnectionOptions, concurrent?: number): ConnectionChain;
}

export type ConnectionOptions = {
    database: string;
    query: `SELECT${string}FROM${string}`;
}

export type DatabaseConnection = {
    database: string;
    connection: Promise<ConnectionPool>;
}

export type ConnectionChain = {
    Execute(fn: (transaction: Transaction, database: string) => Promise<void>): Promise<ExecutionError[]>;
    Retrieve<TResult>(fn: (transaction: Transaction, database: string) => Promise<TResult>): RetrieveChain<TResult>;
}
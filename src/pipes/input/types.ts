import type { Transaction } from "mssql";
import type { RetrieveChain } from "../retrieve/types";
import type { ExecutionError } from "../execute/types";

export type InputChain<TParam> = {
    Execute(fn: (transaction: Transaction, database: string, params: TParam) => Promise<void>): Promise<ExecutionError[]>;
    Retrieve<TResult>(fn: (transaction: Transaction, database: string, params: TParam) => Promise<TResult>): RetrieveChain<TResult>;
}

import type { Transaction } from "mssql";
import { Execute } from "../execute";
import type { DatabaseConnection } from "../connect";
import { Retrieve, type RetrieveChain } from "../retrieve";

export type InputChain<TParam> = {
    Execute(fn: (transaction: Transaction, database: string, params: TParam) => Promise<void>): Promise<void>;
    Retrieve<TResult>(fn: (transaction: Transaction, database: string, params: TParam) => Promise<TResult>): RetrieveChain<TResult>;
}

export const Input = (connections: AsyncGenerator<DatabaseConnection[]>) => {
    return <TParam>(fn: () => TParam): InputChain<TParam> => {
        const params = fn();
        return {
            Execute: Execute(connections, params),
            Retrieve: Retrieve(connections, params)
        }
    }
}

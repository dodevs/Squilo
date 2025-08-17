import type { ConnectionPool, Transaction } from "mssql";
import type { Pool } from "../../pool";
import { type InputChain, Input } from "../input";
import { Execute } from "../execute";
import { type RetrieveChain, Retrieve } from "../retrieve";

export type TemplateParam = {
    string: TemplateStringsArray,
    values: any[]
}

export type ConnectOverloads = {
    (database: string): ConnectionChain;
    (databases: string[]): ConnectionChain;
    (options: ConnectionOptions, concurrent?: number): ConnectionChain;
}

export type ConnectionOptions = {
    database: string;
    query: TemplateParam;
}

export type DatabaseConnection = {
    database: string;
    connection: Promise<ConnectionPool>;
}

export type ConnectionChain = {
    Execute(fn: (transaction: Transaction, database: string) => Promise<void>): Promise<void>;
    Retrieve<TResult>(fn: (transaction: Transaction, database: string) => Promise<TResult>): RetrieveChain<TResult>;
    Input<TParam>(fn: () => TParam): InputChain<TParam>;
}

export const Connect = (pool: Pool): ConnectOverloads => (param: string | string[] | ConnectionOptions, concurrent?: number): ConnectionChain => {
    let connections$: AsyncGenerator<DatabaseConnection[]>;
    let databases$: Promise<string[]>;

    async function *connections(databases$: Promise<string[]>, concurrent: number = Number.MAX_VALUE) {
        const databases = await databases$;
        
        const databases_result_chunks = Array.from(
            {length: Math.ceil(databases.length / concurrent)},
            (_, i) => databases.slice(i * concurrent, (i + 1) * concurrent)
        );

        for (const databases_result_chunk of databases_result_chunks) {
            yield databases_result_chunk.map(database => ({
                database,
                connection: pool.connect({ database })
            }));
        }
    }

    if (typeof param === 'string') {
        databases$ = Promise.resolve([param]);
        connections$ = connections(databases$);
    }

    else if (Array.isArray(param)) {
        databases$ = Promise.resolve(param);
        connections$ = connections(databases$, concurrent);
    }

    else if (typeof param === 'object' && 'query' in param) {
        databases$ = pool
            .connect({ database: param.database })
            .then(conn => conn
                .request()
                .query<{ Database: string }>(
                    param.query.string,
                    param.query.values
                )
            )
            .then(result => result.recordset.map(row => row.Database))
    }

    else {
        throw new Error("Invalid parameter");
    }

    connections$ = connections(databases$);

    return {
        Input: Input(connections$),
        Execute: Execute(connections$, null),
        Retrieve: Retrieve(connections$, null)
    }
  }
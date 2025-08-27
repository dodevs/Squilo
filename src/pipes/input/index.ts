import { Execute } from "../execute";
import type { DatabaseConnection } from "../connect/types";
import { Retrieve } from "../retrieve";
import type { InputChain } from "./types";

export const Input = (connections$: (databases: string[]) => Generator<DatabaseConnection[]>, databases$: Promise<string[]>) => {
    return <TParam>(fn: () => TParam): InputChain<TParam> => {
        const params = fn();
        return {
            Execute: Execute(connections$, databases$, params),
            Retrieve: Retrieve(connections$, databases$, params)
        }
    }
}

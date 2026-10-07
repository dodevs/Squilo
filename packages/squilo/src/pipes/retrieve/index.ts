import { Stream } from "effect";
import { Output } from "../output";
import { Transform } from "../transform";
import type { DatabaseObject } from "../connect/types";
import type { RetrieveChain } from "./types";
import type { RunnerFn, RunStream } from "../shared/runner/types";

export const Retrieve = <T extends string | DatabaseObject>(run: RunStream<T>) =>
    <TReturn>(fn: RunnerFn<T, TReturn>): RetrieveChain<T, TReturn> => {
        const results = Stream.toReadableStream(run(fn));

        return {
            Transform: Transform(results),
            Output: Output(results)
        };
    }

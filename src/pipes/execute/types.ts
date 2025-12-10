import type { ErrorType } from "../shared/transaction-runner";

export type ExecutionError = {
    database: string;
    error: ErrorType;
}
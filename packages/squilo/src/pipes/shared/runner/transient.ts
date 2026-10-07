// SQL Server error numbers worth retrying: deadlock victim, lock timeout, Azure SQL throttling and
// failover, and connections dropped by the network.
const TRANSIENT_NUMBERS: ReadonlySet<number> = new Set([
    1205, 1222,
    40197, 40501, 40613, 49918, 49919, 49920, 10928, 10929,
    64, 233, 10053, 10054, 10060,
]);

// mssql/tedious codes for timeouts and dropped connections.
const TRANSIENT_CODES: ReadonlySet<string> = new Set(["ETIMEOUT", "ESOCKET", "ECONNCLOSED", "ECONNRESET"]);

type ErrorLike = {
    name?: string;
    number?: number;
    code?: string;
    originalError?: unknown;
    error?: unknown;
    suppressed?: unknown;
}

/**
 * Whether an error is worth retrying. Looks inside the `SuppressedError` raised by `await using` when a
 * transaction's rollback fails after the body threw (SQL Server already aborted a deadlock victim's transaction).
 */
export const IsTransientError = (error: unknown): boolean => {
    if (typeof error !== "object" || error === null) {
        return false;
    }

    const e = error as ErrorLike;

    if (e.name === "SuppressedError") {
        return IsTransientError(e.error) || IsTransientError(e.suppressed);
    }

    return (e.number !== undefined && TRANSIENT_NUMBERS.has(e.number))
        || (e.code !== undefined && TRANSIENT_CODES.has(e.code))
        || IsTransientError(e.originalError);
}

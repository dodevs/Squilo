const TRANSIENT_NUMBERS: ReadonlySet<number> = new Set([
    1205, 1222,
    40197, 40501, 40613, 49918, 49919, 49920, 10928, 10929,
    64, 233, 10053, 10054, 10060,
]);

const TRANSIENT_CODES: ReadonlySet<string> = new Set(["ETIMEOUT", "ESOCKET", "ECONNCLOSED", "ECONNRESET"]);

export const IsTransientError = (error: unknown): boolean => {
    const { number, code } = (error ?? {}) as { number?: number; code?: string };

    return (number !== undefined && TRANSIENT_NUMBERS.has(number))
        || (code !== undefined && TRANSIENT_CODES.has(code));
}

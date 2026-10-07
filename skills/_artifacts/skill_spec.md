# Squilo Skill Specification

Generated from domain discovery for the Squilo monorepo.

## Library Overview

**Squilo** is a Bun-first TypeScript library for orchestrating SQL Server connections, authentication, and script execution across multiple databases. It uses a fluent pipeline API:

```
Server(config) → .Auth(strategy) → .Connect(db|dbs|query) → .Retrieve(fn) or .Execute(fn) → [.Transform(fn)] → .Output(strategy)
```

**Monorepo packages:**
| Package | Published | Role |
|---|---|---|
| `squilo` | `squilo` | Core pipeline + built-in strategies |
| `@squilo/msal-auth-strategy` | `@squilo/msal-auth-strategy` | Azure AD authentication via MSAL |
| `@squilo/xls-output-strategy` | `@squilo/xls-output-strategy` | Excel (.xlsx) output via SheetJS |

---

## Skill Catalog

### 1. connect-to-server

**When to use:** Setting up the initial `Server()` configuration for dev, QA, or production environments.

**Prerequisites:** Bun v1.2.20+, SQL Server instance (local, Azure, or Docker).

**Key APIs:**
- `Server(config: ServerConfig): ServerChain`
- `ServerConfig = Omit<config, "authentication" | "user" | "password">` (from `mssql`)

**Common fields:**
| Field | Type | Required | Description |
|---|---|---|---|
| `server` | `string` | ✅ | Hostname or IP |
| `port` | `number` | ❌ | Default 1433 |
| `options.encrypt` | `boolean` | ❌ | Set `false` for local dev |
| `options.trustServerCertificate` | `boolean` | ❌ | Set `true` for local dev |

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Confusing `Server()` with web server frameworks (Hono, Express) | `Server()` is a SQL Server connection factory — always chained with `.Auth()` |
| Forgetting `.Auth()` after `Server()` — chain is incomplete | `Server(config).Auth(strategy)` is the minimum viable chain |

**Related skills:** `setup-authentication` (always next step), `setup-testcontainers` (for test environments).

---

### 2. setup-authentication

**When to use:** Choosing and configuring the authentication method for SQL Server connections.

**Package scope:** Core `squilo` for SQL auth. Extension `@squilo/msal-auth-strategy` for Azure AD.

**Key APIs:**
- `UserAndPassword(username, password): AuthStrategy` — core package
- `ActiveDirectoryAccessToken(config): Promise<AuthStrategy>` — `@squilo/msal-auth-strategy`
- `GetToken(config): Promise<string>` — standalone MSAL token acquisition

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| `import { ActiveDirectoryAccessToken } from "squilo"` | `import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy"` |
| Installing only `squilo` and trying Azure AD auth | `bun add squilo @squilo/msal-auth-strategy` |
| Not `await`-ing `ActiveDirectoryAccessToken(config)` (returns `Promise<AuthStrategy>`) | `Server(...).Auth(await ActiveDirectoryAccessToken({...}))` |
| Not understanding MSAL token cache lifecycle | Token cache lives in `.active-directory-cache/<tenantId>-<clientId>.json` — silent auth reads cache, interactive auth writes it |

**Related skills:** `connect-to-server` (prerequisite), `create-custom-auth-strategy` (for non-standard auth).

---

### 3. connect-to-databases

**When to use:** Specifying which database(s) to connect to after authentication is configured.

**Key APIs:**
- `.Connect(database: string, options?: ExecutionOptions)` — single database
- `.Connect(databases: string[], options?: number | ExecutionOptions)` — multiple databases; the callback's `database` is one `string`
- `.Connect<T extends DatabaseObject>(query: ConnectionOptions, options?: number | ExecutionOptions)` — dynamic discovery via query
- `ExecutionOptions`: `{ concurrent?, retry?: number | { times, delay?, while? }, timeout?: number | "N unit", signal?: AbortSignal }` — a bare number for `options` is `concurrent`; concurrency defaults to unbounded and is a sliding window; retry of transient errors (`IsTransientError`), per-database timeout, `AbortSignal` cancellation

**ConnectionOptions:**
```ts
type ConnectionOptions = {
  database: string;           // Management database (e.g., "ClientsManager")
  query: `SELECT ${string}[Database]${string} FROM ${string}`; // Must include "Database" column
}
```

**Dynamic discovery:** The query must return rows with a `Database` field, e.g. `SELECT DatabaseName AS [Database], ClientName FROM Clients`. Extra columns become properties on the database object; pass their type explicitly (`.Connect<{ Database: string; ClientName: string }>(...)`) to use them in the callback. The discovery connection is closed after the query; if the query fails, `.Execute()` / `.Output()` reject with that error.

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Manually managing connection pool lifecycle | Pools are auto-cached by DB name and auto-closed after Execute/Retrieve |
| Forgetting `database` in pool config | `Pool.connect()` throws if database is undefined |

**Related skills:** `connect-to-server`, `setup-authentication` (prerequisites), `retrieve-data`, `execute-updates` (next steps).

---

### 4. retrieve-data

**When to use:** Querying data from one or more databases. Returns a stream of results.

**Key API:** `.Retrieve(fn): RetrieveChain<T, TReturn>`

**Signature:**
```ts
Retrieve(
  fn: (connection: ConnectionPoolWrapper, database: T) => Promise<TReturn>
): RetrieveChain<T, TReturn>
```

**Important patterns:**
- The callback's `connection` is opened and released by the runner (even on error; errors while closing are ignored) — don't close or wrap it. `ConnectionPoolWrapper` is not exported from `squilo`
- `connection.transaction$()` returns a `TransactionWrapper` — use `await using tx = await conn.transaction$()`, run queries with `tx.request().query`, call `commit$()` to commit; it rolls back on disposal unless `commit$()` succeeded (a failing `commit$()` rolls back; a deadlock victim is not rolled back again, so error 1205 surfaces as-is)
- Results stream through a lazy `ReadableStream` — nothing runs until `.Output()` or `.Transform() → .Output()` consumes it

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Not ending Retrieve chain with `.Output()` or `.Transform() → .Output()` | Retrieve is lazy — without Output nothing runs |
| Closing `conn` manually inside the callback | Just use `conn` — the runner releases each database's connection |
| Putting expensive post-processing inside `.Retrieve()` callback | Use `.Transform()` for expensive ops — each database's connection is released before its result reaches Transform |
| Not destructuring tuple return from `.Output()` | `const [errors, result] = await ...Output(...)` — errors are in the first element |

**Related skills:** `connect-to-databases` (prerequisite), `transform-data`, `output-results` (next steps), `handle-errors`.

---

### 5. execute-updates

**When to use:** Running UPDATE, INSERT, DELETE, or DDL operations across multiple databases.

**Key API:** `.Execute(fn): Promise<ExecutionError<T>[]>`

**Signature:**
```ts
Execute(
  fn: (connection: ConnectionPoolWrapper, database: T) => Promise<void>
): Promise<ExecutionError<T>[]>
```

**Important notes:**
- Returns `ExecutionError[]` directly — NOT a tuple like Retrieve → Output
- No `.Output()` method available on Execute chain
- Errors are collected, not thrown — always check the returned array (only a failing discovery query rejects)
- `SAFE_GUARD` applies: halts further connections after N errors

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Trying to chain `.Output()` after `.Execute()` | `.Execute()` returns `Promise<ExecutionError[]>` directly — no `.Output()` method |
| Not checking returned `ExecutionError[]` array | Always check `const errors = await ...Execute(...)` — errors are returned, not thrown |
| Assuming a single error stops all databases | `SAFE_GUARD` (default=1) halts further connections — in-flight DBs finish, DBs not yet started are skipped |

**Related skills:** `connect-to-databases` (prerequisite), `handle-errors`, `transform-data`.

---

### 6. transform-data

**When to use:** Expensive post-processing that should happen AFTER a database's connection is released.

**Key API:** `.Transform(fn): TransformChain<T, TOutput>`

**Signature:**
```ts
Transform(
  transformFn: (data: TReturn) => TOutput | Promise<TOutput>
): TransformChain<T, TOutput>
```

**Critical design:** Transform is a `TransformStream` in the pipeline. The `Retrieve` pipe exposes the runner's stream as a lazy `ReadableStream`, emitting one result per database in completion order; each database's connection is released before its result is emitted. The transform function runs once per successful result with that database's data only (errored results bypass it; the database name is not passed), while other databases may still be running. It never sees all databases at once — aggregate across databases after a merging output.

**When to use Transform:**
- File I/O (reading/writing files)
- External API calls
- Heavy computation (data normalization, ML inference)
- Data enrichment from other sources

**When NOT to use Transform (use inline in Retrieve instead):**
- Simple mapping/filtering of query results
- Type casting
- Small data reshaping

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Putting file I/O / API calls inside `.Retrieve()` callback | Move expensive ops to `.Transform()` — it runs per database, after that database's connection is released |
| Using Transform for simple array mapping | Inline the mapping in Retrieve — Transform adds unnecessary stream overhead |

**Related skills:** `retrieve-data` (prerequisite), `output-results` (next step).

---

### 7. output-results

**When to use:** Choosing how to consume and format the results from Retrieve.

**Package scope:** Core `squilo` for built-in strategies. Extension `@squilo/xls-output-strategy` for Excel.

**Built-in strategies (core package):**
- `MergeOutputStrategy()` — flattens all results into a single array, collects errors
- `JsonOutputStrategy(includeEmpty?, includeErrors?)` — writes JSON file, filename auto-derived from `process.argv[1]`
- `ConsoleOutputStrategy()` — `console.log` each chunk

**Extension strategies:**
- `XlsOutputStrategy(combineSheets?, includeEmpty?, includeErrors?)` — Excel output, requires `@squilo/xls-output-strategy`

**Return types:**
| Strategy | Default Return | `includeErrors: true` |
|---|---|---|
| Merge | `[ExecutionError[], TMerged[]]` | N/A |
| Json | `[ExecutionError[], string]` (filename) | `string` (filename, errors embedded in file) |
| Console | `void` | N/A |
| Xls | `[ExecutionError[], string]` (filename) | `string` (filename, errors in "Errors" sheet) |

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| `import { XlsOutputStrategy } from "squilo"` | `import { XlsOutputStrategy } from "@squilo/xls-output-strategy"` |
| Installing only `squilo` and trying Excel output | `bun add squilo @squilo/xls-output-strategy` |
| Not destructuring tuple return from `.Output()` | `const [errors, result] = await ...Output(...)` |
| Hardcoding filenames for JsonOutputStrategy | Filename auto-derived from `process.argv[1]` + timestamp |
| Assuming all output strategies are in core | Check package: Merge/Json/Console = core, Xls = extension |

**Related skills:** `retrieve-data` (prerequisite), `create-custom-output-strategy` (for bespoke formatting).

---

### 8. handle-errors

**When to use:** Understanding and handling errors across multi-database operations. **This is the #1 source of developer confusion.**

**Key concepts:**

**SAFE_GUARD environment variable:**
- Default: `1` (from `LoadEnv()`)
- Behavior: Limits how many database connection/query errors trigger before halting further connections
- Setting `SAFE_GUARD=0` disables the guard entirely
- Invalid values (e.g., `"invalid"`) parse to `NaN` — effectively disables guard
- In-flight databases still finish after SAFE_GUARD triggers; databases not yet started are skipped

**Error flow:**
1. Runner turns each database's failure into an `error` result (connection, query, `TimeoutError`, `AbortError`, `UnfinishedWorkError`); with `retry`, only the final failure counts
2. The first `min(SAFE_GUARD, concurrent)` databases run one at a time, so a systematic failure halts the run before fanning out
3. Once SAFE_GUARD errors are reached, databases not yet started are skipped (no result emitted); in-flight ones finish
4. Errors returned in `ExecutionError[]` tuple — NOT thrown (only a failing discovery query rejects the whole operation)

**ExecutionError shape:**
```ts
type ExecutionError<T> = {
  database: T;
  error: ErrorType; // Error | ConnectionError | TransactionError | RequestError | PreparedStatementError
}
```

**Mssql-specific error fields:** `code`, `number`, `state`, `class`, `serverName`, `procName`, `lineNumber`

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Agents look for external "errors file" | Errors returned as `[ExecutionError[], result]` tuple — handle in code |
| Thinking SAFE_GUARD stops the entire script | SAFE_GUARD stops *further connections* — in-flight DBs finish, DBs not yet started are skipped |
| Assuming errors are thrown | Errors are collected and returned — check the array |
| Setting SAFE_GUARD to a string expecting it to work | Invalid values = `NaN` (disables guard). Use numeric env vars. |

**Related skills:** All pipeline skills (errors affect every operation).

---

### 9. create-custom-auth-strategy

**When to use:** Implementing non-standard authentication (certificates, key vault tokens, custom identity providers).

**Key type:** `AuthStrategy = (config: ServerConfig) => config` (`config` = mssql connection config, auth fields included)

**Pattern:**
```ts
const MyCustomAuth = (token: string): AuthStrategy => (config) => ({
  ...config,
  authentication: {
    type: "azure-active-directory-access-token",
    options: { token }
  }
});
```

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Mutating the config object | AuthStrategy returns a *new* config object: `(config) => ({...config, ...auth})` |

**Related skills:** `setup-authentication` (for built-in strategies).

---

### 10. create-custom-output-strategy

**When to use:** Implementing bespoke result formatting (CSV, PDF, webhook push, database write-back).

**Key type:** `OutputStrategy<T, TReturn, TOutput> = (data: ReadableStream<ExecutionResult<T, TReturn>>) => Promise<TOutput>`

**Pattern:**
```ts
const CsvOutputStrategy = (): OutputStrategy<T, TReturn, [ExecutionError<T>[], string]> => async (result) => {
  const errors: ExecutionError<T>[] = [];
  const rows: string[] = [];

  for await (const item of result) {
    if (item.error) {
      errors.push({ database: item.database, error: item.error });
      continue;
    }
    rows.push(formatAsCsv(item.data));
  }

  // ... write to file
  return [errors, filename];
};
```

**Wrong / Correct:**
| ❌ Wrong | ✅ Correct |
|---|---|
| Not handling `ExecutionResult` stream chunks properly | Must iterate `for await (const item of result)` and check `item.error` vs `item.data` |

**Related skills:** `output-results` (for built-in strategies).

---

### 11. integrate-honojs

**When to use:** Building streaming API routes with Hono that serve Squilo query results over HTTP.

**Pattern:** Hono route that uses `.Retrieve()` → `.Output()` and streams results to the client, or accumulates and returns JSON.

**Key consideration:** Hono's `Response` helper can accept a `ReadableStream` for true streaming, or you can accumulate with `MergeOutputStrategy()` and return JSON.

**Related skills:** `retrieve-data`, `output-results`.

---

### 12. setup-testcontainers

**When to use:** Setting up integration tests with Azure SQL Edge in Docker containers.

**Pattern:** A `UseSqlServer(setup?)` helper (the repo's own `test/container/container.ts`, not exported by `squilo` — copy the pattern): starts Azure SQL Edge in `beforeAll` with its own hook timeout (`SQL_SERVER_TIMEOUT`; bunfig's `timeout` only applies to tests), waits until logins work, runs `setup`, stops the container in `afterAll`. `sql.server` / `sql.container` only work inside tests or hooks ("SQL Server is not started yet" at describe time).

**Key consideration:** The progress bar is silent when `Bun.env.NODE_ENV === 'test'` (`src/pipes/shared/progress.ts`; `bun test` sets it unless already set). On Windows, Bun can't reach Docker's named pipe ("Could not find a working container runtime strategy"): run the tests in a Linux Bun container — `bun run test:docker` from the repo root.

**Related skills:** `connect-to-server`, `connect-to-databases`.

---

### 13. getting-started

**When to use:** First-time onboarding — interactive walkthrough from zero to a working script.

**Journey:**
1. Prompt for server URL (e.g., `localhost:1433` or `thing.database.windows.net`)
2. Prompt for auth method (SQL auth or Azure AD)
3. Prompt for database name(s)
4. Generate a test script using `Server → Auth → Connect → Retrieve → Output`

**Key reminders:**
- Include `import { Server, UserAndPassword, MergeOutputStrategy } from "squilo"`
- For Azure AD: include `@squilo/msal-auth-strategy` import and install

**Related skills:** All core pipeline skills.

---

### 14. generate-report

**When to use:** End-to-end report generation across multiple tenant databases.

**Journey:**
1. Connect to management database to discover tenant DBs
2. Retrieve usage/cost data from each tenant DB
3. Transform/aggregate if needed
4. Output to Excel (`XlsOutputStrategy`) or JSON (`JsonOutputStrategy`)
5. Handle errors with `SAFE_GUARD` awareness

**Example flow:**
```ts
const [errors, filename] = await Server({...})
  .Auth(UserAndPassword("sa", "password"))
  .Connect({
    database: "ClientsManager",
    query: `SELECT DatabaseName AS [Database], ClientName FROM Clients WHERE Active = 1`
  })
  .Retrieve(async (conn, db) => {
    const result = await conn.query`
      SELECT ClientName, UsageHours, Cost FROM UsageReport
      WHERE Month = ${currentMonth}
    `;
    return result.recordset;
  })
  .Output(XlsOutputStrategy(true, true, false)); // combined sheets
```

**Related skills:** `connect-to-databases`, `retrieve-data`, `transform-data`, `output-results`, `handle-errors`.

---

## Global Failure Mode Reference

### SAFE_GUARD Confusion
**Symptom:** Developer thinks errors stop everything or expects thrown exceptions.
**Reality:** `SAFE_GUARD` (default=1, env var) limits how many DB errors trigger before halting *further* connections. In-flight DBs finish; DBs not yet started are skipped. Errors are returned as data (only a failing discovery query rejects).
**Fix:** Check `errors.length` from the return value. Set `SAFE_GUARD=0` to disable.
**Affected skills:** handle-errors, execute-updates, retrieve-data.

### Monorepo Import Mismatch
**Symptom:** `ERR_PACKAGE_PATH_NOT_EXPORTED` or missing types at runtime.
**Cause:** Using outdated subpath imports (`squilo/auth/strategies`) or importing from wrong package.
**Fix:** Core exports use `import { ... } from "squilo"`. Extensions use their own package names.
**Affected skills:** setup-authentication, output-results.

### Connection Pool Not Closing
**Symptom:** Memory leaks or "too many connections" errors.
**Cause:** Managing connections manually instead of letting the runner do it, or leaving a transaction/query unfinished when the callback returns.
**Reality:** Pools are cached by DB name. The runner opens each database's connection and releases it after the callback, even on error; a callback that returns with work still running fails with `UnfinishedWorkError` and the connection is force-closed.
**Fix:** Just use the callback's `conn` — don't close or wrap it. Use `await using tx = await conn.transaction$()` for transactions and await every query.
**Affected skills:** retrieve-data, execute-updates.

### Transaction Auto-Rollback
**Symptom:** Changes appear to succeed but are not persisted.
**Cause:** Using `await using` on `TransactionWrapper` but not calling `commit$()`.
**Reality:** `TransactionWrapper` auto-rolls back on disposal unless `commit$()` succeeded (a failing `commit$()` rolls back; a deadlock victim is not rolled back again, so error 1205 surfaces as-is).
**Fix:** Run queries with `transaction.request().query` (not `conn.query`, which uses another pooled connection) and call `await transaction.commit$()` before the `await using` scope exits.
**Affected skills:** retrieve-data, execute-updates.

### Stream Not Consumed
**Symptom:** Script ends after `.Retrieve()` without querying anything — no error, no output.
**Cause:** `.Retrieve()` returns a lazy `ReadableStream`. Without `.Output()` or `.Transform() → .Output()`, nothing runs.
**Fix:** Always end Retrieve chain with `.Output(strategy)` or `.Transform(fn).Output(strategy)`.
**Affected skills:** retrieve-data, transform-data, output-results.
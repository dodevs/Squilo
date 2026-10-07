# Squilo — Codebase Context

## Project Overview

**Squilo** is a **Bun-first TypeScript monorepo** for orchestrating SQL Server connections, authentication, and script execution across multiple databases. It targets multi-database scenarios: multi-tenant SaaS, batch jobs, migrations, reporting, and ETL pipelines.

- **Runtime**: Bun (v1.2.20+), uses Bun-specific APIs (`Bun.file()`, `Bun.write()`, `Bun.env`, `await using` disposal)
- **Language**: TypeScript strict mode, ESNext target, ESM only
- **Build**: `bunup` with per-package config (workspace build at root `bunup.config.ts`)
- **Linter/Formatter**: Biome 2.3.11 (tabs, double quotes)
- **Tests**: `bun:test` with `testcontainers` (Azure SQL Edge Docker image)
- **License**: MIT

---

## Repository Structure

```
Squilo/
├── package.json                 # Root workspace (private, workspaces: ["packages/*"])
├── bunup.config.ts              # Workspace build: squilo, msal-auth-strategy, xls-output-strategy
├── biome.json                   # Biome config: tabs, double quotes
├── tsconfig.json                # Root TS: strict, noEmit, isolatedDeclarations, noUncheckedIndexedAccess
├── bun.lock / bunfig.toml       # Bun package manager
├── README.md / AGENTS.md / context.md
├── scripts/test-docker.ts       # `bun run test:docker`: runs the suite in a Linux Bun container
│
├── packages/
│   ├── squilo/                  # Core pipeline + built-in strategies (published as "squilo", v0.8.0-beta.1)
│   │   ├── src/                 # Main source code
│   │   ├── test/                # Integration tests (Azure SQL Edge container)
│   │   ├── skills/              # 14 @tanstack/intent SKILL.md files
│   │   ├── dist/                # Build output
│   │   └── package.json
│   │
│   ├── msal-auth-strategy/      # Azure AD auth extension (published as "@squilo/msal-auth-strategy", v0.8.0-beta.1)
│   │   ├── src/                 # msal.ts + index.ts
│   │   ├── dist/
│   │   └── package.json
│   │
│   └── xls-output-strategy/     # Excel output extension (published as "@squilo/xls-output-strategy", v0.8.0-beta.1)
│       ├── src/                 # xls.ts + index.ts
│       ├── test/                # xls.spec.ts
│       ├── dist/
│       └── package.json
│
└── skills/
    └── _artifacts/              # @tanstack/intent scaffold artifacts
        ├── domain_map.yaml      # Domain organization (core-pipeline, extensibility, integration, journeys)
        ├── skill_spec.md        # Detailed skill specification
        └── skill_tree.yaml      # Full skill catalog (14 skills)
```

---

## Monorepo Architecture

The root `package.json` is private with `workspaces: ["packages/*"]`. Three packages share the same `0.8.0-beta.1` version:

| Package | Published as | Role | Key dependency |
|---|---|---|---|
| `packages/squilo` | `squilo` | Core pipeline + SQL auth + built-in output strategies | `mssql`, `cli-progress`, `effect` (internal runtime) |
| `packages/msal-auth-strategy` | `@squilo/msal-auth-strategy` | Azure AD (Entra ID) interactive/silent auth | `@azure/msal-node`, `open` |
| `packages/xls-output-strategy` | `@squilo/xls-output-strategy` | Excel `.xlsx` output with separate or combined sheets | `xlsx` (SheetJS CDN tarball) |

Extension packages (`msal-auth-strategy`, `xls-output-strategy`) declare `squilo` as a **peer dependency** using workspace protocol: `"squilo": "workspace:^0.8.0-beta.1"`. They import types from `squilo` (`AuthStrategy`, `OutputStrategy`, `ExecutionResult`, etc.) but do not bundle them.

**Build**: Root `bunup.config.ts` uses `defineWorkspace()` to configure three parallel ESM builds. Each package gets its own `dist/` with code splitting and declaration file generation. All use `format: "esm"`, `target: "bun"`, `sourcemap: "linked"`, `splitting: true`, and `exports: true`.

---

## Core Pipeline Architecture

The API is a **fluent chain** enforced via TypeScript types:

```
Server(config) → .Auth(strategy) → .Connect(db|dbs|query) → .Retrieve(fn) or .Execute(fn) → [.Transform(fn)] → .Output(strategy)
```

Each step returns a constrained chain object that only exposes the next valid method(s). There are **no runtime checks** — the type system enforces correctness at compile time.

### Step-by-step pipeline

| Step | Exported from | Input | Returns | Next method |
|---|---|---|---|---|
| `Server(config)` | `squilo` | `ServerConfig` (mssql config minus auth) | `ServerChain` | `.Auth(strategy)` |
| `.Auth(strategy)` | built into ServerChain | `AuthStrategy` function | `AuthenticationChain` | `.Connect(db/dbs/query)` |
| `.Connect(db, options?)` | built into AuthenticationChain | `string`, `string[]`, or `ConnectionOptions`; options: `ExecutionOptions` (or a concurrency `number` for `string[]` / `ConnectionOptions`) | `ConnectionChain<T>` | `.Execute(fn)` or `.Retrieve(fn)` |
| `.Retrieve(fn)` | built into ConnectionChain | callback `(ConnectionPoolWrapper, T) => Promise<TReturn>` | `RetrieveChain<T, TReturn>` | `.Transform(fn)` or `.Output(strategy)` |
| `.Execute(fn)` | built into ConnectionChain | callback `(ConnectionPoolWrapper, T) => Promise<void>` | `Promise<ExecutionError<T>[]>` | *(terminal)* |
| `.Transform(fn)` | built into RetrieveChain | `TransformFunction<TInput, TOutput>` | `TransformChain<T, TOutput>` | `.Output(strategy)` |
| `.Output(strategy)` | built into RetrieveChain or TransformChain | `OutputStrategy<T, TReturn, TOutput>` | `Promise<TOutput>` | *(terminal)* |

### Chain type definitions

```ts
// packages/squilo/src/pipes/server/types.ts
type ServerConfig = Omit<config, "authentication" | "user" | "password">;
type ServerChain = { Auth(strategy: AuthStrategy): AuthenticationChain; }

// packages/squilo/src/pipes/auth/types.ts
type AuthenticationChain = {
    Connect(database: string, options?: ExecutionOptions): ConnectionChain<string>;
    Connect(databases: string[], options?: number | ExecutionOptions): ConnectionChain<string>; // callback gets one database
    Connect<T extends DatabaseObject>(query: ConnectionOptions, options?: number | ExecutionOptions): ConnectionChain<T>;
}

// packages/squilo/src/pipes/connect/types.ts
type DurationInput = number | `${number} ${"milli" | "millis" | "second" | "seconds" | "minute" | "minutes" | "hour" | "hours"}`;
type RetryOptions = { times: number; delay?: DurationInput; while?: (error: ErrorType) => boolean };
type ExecutionOptions = {
    concurrent?: number;            // a plain number passed to Connect means this
    retry?: number | RetryOptions;
    timeout?: DurationInput;
    signal?: AbortSignal;
}

type ConnectionChain<T> = {
    Execute(fn: (conn: ConnectionPoolWrapper, database: T) => Promise<void>): Promise<ExecutionError<T>[]>;
    Retrieve<TResult>(fn: (conn: ConnectionPoolWrapper, database: T) => Promise<TResult>): RetrieveChain<T, TResult>;
}

// packages/squilo/src/pipes/retrieve/types.ts
type RetrieveChain<T, TReturn> = {
    Transform<TOutput>(transformFn: TransformFunction<TReturn, TOutput>): TransformChain<T, TOutput>;
    Output<TOutput>(strategy: OutputStrategy<T, TReturn, TOutput>): Promise<TOutput>;
}

// packages/squilo/src/pipes/transform/types.ts
type TransformChain<T, TOutput> = {
    Output<TFinalOutput>(strategy: OutputStrategy<T, TOutput, TFinalOutput>): Promise<TFinalOutput>;
};
```

---

## Key Design Patterns

### 1. Pool Caching (`packages/squilo/src/pool/index.ts`)

The `Pool` factory creates a `Record<string, () => Promise<ConnectionPool>>` cache keyed by database name. When `.Connect("MyDB")` is called, it checks the cache. The pool's `close()` is **patched** to delete the cache entry. Errors also delete the cache entry. The `Pool` is created once in `Auth()` and passed down through closures — each `.Connect()` call shares the same pool cache.

```ts
export type Pool = {
    connect: (partialConfig: Partial<config>) => () => Promise<ConnectionPool>;
}

export function Pool(poolConfig: config): Pool {
    const POOL: Record<string, () => Promise<ConnectionPool>> = {};
    return {
        connect: (partialConfig: Partial<config>) => {
            const config = { ...poolConfig, ...partialConfig };
            const database = config.database;
            // Cache check, patching close(), error handler...
            POOL[database] = () => pool.connect().then(() => pool);
            return POOL[database]!;
        },
    }
}
```

The Pool is created once in `Auth()` and shared across all `Connect()` calls — same server, different databases share the pool infrastructure.

### 2. AsyncDisposable Pattern (`packages/squilo/src/pool/index.ts`)

`ConnectionPoolWrapper` wraps `ConnectionPool` and implements `Symbol.asyncDispose`. Used with `await using` for auto-close. Adds `transaction$()` method.

`TransactionWrapper` wraps `Transaction` and implements `Symbol.asyncDispose`. **Auto-rolls back** on disposal unless `commit$()` succeeded; a failing `commit$()` leaves the flag unset, so the transaction is rolled back. A deadlock victim (already aborted by SQL Server, mssql sets `_aborted`) is not rolled back again, so error 1205 surfaces as-is instead of a `SuppressedError`. Both wrappers extend the mssql object in place (`Object.assign`), so mssql's own state updates stay visible:

```ts
export interface ConnectionPoolWrapper extends ConnectionPool, AsyncDisposable {
    transaction$: () => Promise<TransactionWrapper>;
}

// [Symbol.asyncDispose] on ConnectionPoolWrapper → pool.close()
// [Symbol.asyncDispose] on TransactionWrapper → rollback() if !committed and not aborted by SQL Server, else no-op
```

Errors while closing a connection are ignored.

### 3. Streaming Architecture

`Retrieve` is **lazy**: nothing runs until `Output` consumes it. It exposes the Runner's Effect `Stream` as a `ReadableStream` (`Stream.toReadableStream`) of `ExecutionResult` chunks in completion order. The `Transform` pipe inserts a `TransformStream` via `pipeThrough()`; it runs once per database result with that database's data only (errored results bypass it). `Output` consumes the final `ReadableStream`.

This enables **early connection release**: each database's connection is released before its result is emitted, so expensive Transform/Output work never holds a connection.

```
Runner (per DB: acquire → fn → release) → result emitted → TransformStream → Output consumes
                                          (DB conn closed)   (transform work)  (write to file)
```

### 4. SAFE_GUARD (`packages/squilo/src/utils/load-env.ts`, applied in `pipes/shared/runner/index.ts`)

Environment variable `SAFE_GUARD` sets how many database errors trip the guard. Default: `1`. `0` or an invalid value (`NaN`) disables it.

- The first `min(SAFE_GUARD, concurrent)` databases run one at a time, so an error that would hit every database trips the guard early.
- Once `SAFE_GUARD` errors happened, databases not yet started are skipped and emit no result; in-flight ones finish.
- With `retry`, only a database's final failure counts.

There is no error class for this: skipped databases are simply absent from the results.

### 5. Concurrency, Retry, Timeout and Cancellation (`packages/squilo/src/pipes/shared/runner/index.ts`)

`concurrent` defaults to unbounded. After the SAFE_GUARD warm-up, the remaining databases run through `Stream.mapEffect` with a sliding window (`unordered: true`): a new database starts as soon as any running one finishes.

- `retry` re-runs the callback on a fresh connection with exponential backoff (default delay `200 millis`); by default only `IsTransientError` errors (`shared/runner/transient.ts`) are retried.
- `timeout` fails the database with a `TimeoutError`; `signal` skips not-started databases and fails in-flight ones with an `AbortError`. Interrupted connections are force-closed (`ForceClose` in `pool/index.ts`), so SQL Server rolls back the open transaction.
- A callback that returns while a connection is still busy (open transaction, un-awaited query) fails with an `UnfinishedWorkError`.

All of these are returned as data (`{ database, error }`), not thrown.

### 6. Dynamic Database Discovery (`packages/squilo/src/pipes/connect/types.ts`)

`ConnectionOptions` allows specifying a management database and a SQL query that returns rows with a `Database` column:

```ts
type DatabaseObject = object & { Database: string; }
type ConnectionOptions = {
    database: string;
    query: `SELECT ${string}[Database]${string} FROM ${string}`;
}
```

Additional columns from the query become properties on `T`, accessible in Retrieve/Execute callbacks. The query runs on a connection to `database` that is closed once it returns (`pipes/connect/index.ts`). A failing discovery query is the one error not returned as data: it rejects `Execute()` / `Output()`.

---

## Source File Map (`packages/squilo/src/`)

```
packages/squilo/src/
├── index.ts                          # Main exports: Server, SQL (mssql re-export), types, strategies
├── pool/
│   └── index.ts                      # Pool, ConnectionPoolWrapper, TransactionWrapper
├── utils/
│   └── load-env.ts                   # Loads SAFE_GUARD env var
└── pipes/
    ├── types.ts                      # Re-exports auth/types
    ├── server/
    │   ├── index.ts                  # Server(config) → ServerChain
    │   └── types.ts                  # ServerConfig, ServerChain
    ├── auth/
    │   ├── index.ts                  # Auth(config)(strategy) → AuthenticationChain, creates Pool
    │   ├── types.ts                  # AuthenticationChain (Connect overloads)
    │   └── strategies/
    │       ├── index.ts              # Exports UserAndPassword + AuthStrategy type
    │       ├── types.ts              # AuthStrategy = (config: ServerConfig) => config
    │       └── userAndPassword.ts    # SQL auth: UserAndPassword(user, pass)
    ├── connect/
    │   ├── index.ts                  # Connect(pool) — single DB, array, or discovery query
    │   └── types.ts                  # ConnectionChain, DatabaseObject, ConnectionOptions, ExecutionOptions, RetryOptions, DurationInput
    ├── retrieve/
    │   ├── index.ts                  # Retrieve — Runner stream exposed as a ReadableStream
    │   └── types.ts                  # RetrieveChain (Transform | Output)
    ├── execute/
    │   └── index.ts                  # Execute — runs fn per DB, collects errors
    ├── transform/
    │   ├── index.ts                  # Transform — pipeThrough TransformStream
    │   └── types.ts                  # TransformChain, TransformFunction
    ├── output/
    │   ├── index.ts                  # Output — delegates to strategy
    │   └── strategies/
    │       ├── index.ts              # Exports Merge, Console, Json + OutputStrategy type
    │       ├── types.ts              # OutputStrategy<T, TReturn, TOutput>
    │       ├── merge.ts              # MergeOutputStrategy — flat-merge all results
    │       ├── json.ts               # JsonOutputStrategy — write JSON file (configurable includeEmpty/includeErrors)
    │       ├── console.ts            # ConsoleOutputStrategy — console.log each chunk
    │       ├── merge.spec.ts
    │       ├── json.spec.ts
    │       └── console.spec.ts
    └── shared/
        ├── progress.ts               # Progress() — cli-progress bar, silent when NODE_ENV=test
        └── runner/
            ├── index.ts              # Runner — Effect Stream: per-DB acquire/release, sliding-window concurrency, SAFE_GUARD, retry/timeout/abort
            ├── transient.ts          # IsTransientError — default retry predicate
            └── types.ts              # RunStream, RunnerFn, ExecutionResult, ExecutionError, ErrorType, Databases
```

### Extension package sources

```
packages/msal-auth-strategy/src/
├── index.ts                          # Exports GetToken, ActiveDirectoryAccessToken + re-export AuthStrategy
└── msal.ts                           # PublicClientApplication, silent → interactive auth flow, token caching

packages/xls-output-strategy/src/
├── index.ts                          # Exports XlsOutputStrategy
└── xls.ts                            # XlsOutputStrategy: separate sheets or combined sheet with row grouping
```

---

## Main Exports (`packages/squilo/src/index.ts`)

```ts
export * from "./pipes/server";                     // Server
export * as SQL from "mssql";                       // Raw mssql access

// Types
export type { AuthStrategy } from "./pipes/auth/strategies/types";
export type { ServerConfig } from "./pipes/server/types";
export type { OutputStrategy } from "./pipes/output/strategies/types";
export type { ExecutionResult, ExecutionError, ErrorType } from "./pipes/shared/runner/types";
export type { DatabaseObject, DurationInput, ExecutionOptions, RetryOptions } from "./pipes/connect/types";

// Built-in strategies
export { UserAndPassword } from "./pipes/auth/strategies";
export { MergeOutputStrategy, ConsoleOutputStrategy, JsonOutputStrategy } from "./pipes/output/strategies";
export { IsTransientError } from "./pipes/shared/runner/transient";
```

`effect` is an internal runtime dependency: no public type references it.

> **Note**: The old `squilo/auth` and `squilo/output` subpath exports were removed during the monorepo conversion. The previous `ActiveDirectoryAccessToken` (was in `packages/squilo/src/pipes/auth/strategies/msal.ts`) and `XlsOutputStrategy` (was in `packages/squilo/src/pipes/output/strategies/xls.ts`) were extracted into their own packages: `@squilo/msal-auth-strategy` and `@squilo/xls-output-strategy`.

---

## Built-in Output Strategies

### MergeOutputStrategy
Returns `[ExecutionError<T>[], TMerged[]]`. Flat-merges all `data` arrays into one. Handles both `Array.isArray(data)` (spreads) and single values (pushes). Errors are collected separately.

### JsonOutputStrategy
Returns `[ExecutionError<T>[], string]` (filename) by default. Positional booleans: `JsonOutputStrategy(includeEmpty = true, includeErrors = false)`; with `includeErrors: true` it returns just the filename. Writes using `Bun.file().writer()` with streaming JSON. Naming: `<script-name>-<timestamp>.json`.

### ConsoleOutputStrategy
Returns `void`. Iterates the stream with `for await` and `console.log()`s each chunk.

### XlsOutputStrategy (`@squilo/xls-output-strategy`)
Returns `[ExecutionError<T>[], string]` (filename) by default. Options: `combineSheets` (default `false` — separate sheet per DB), `includeEmpty` (default `true`), `includeErrors` (default `false`). Combined mode uses Excel row grouping (outline levels). Sheet names truncated to 31 chars. Uses `Bun.write()` for output.

---

## Auth Strategies

### UserAndPassword (built-in, `packages/squilo`)
Simple SQL auth: `UserAndPassword(username, password): AuthStrategy`

### ActiveDirectoryAccessToken (extension, `@squilo/msal-auth-strategy`)
Azure AD auth via `@azure/msal-node`. Flow: silent token acquisition → fallback to interactive browser auth. Caches tokens in `.active-directory-cache/<tenantId>-<clientId>.json`. Uses `open` to launch browser. Returns `AuthStrategy` that sets `authentication.type = 'azure-active-directory-access-token'`.

Also exports `GetToken(config: NodeAuthOptions): Promise<string>` for standalone token acquisition outside pipelines.

---

## Type Definitions Reference

### Execution types (`packages/squilo/src/pipes/shared/runner/types.ts`)

```ts
type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;
type ExecutionError<T> = { database: T; error: ErrorType };
type ExecutionResult<T, TReturn> = { database: T } & Partial<{ data: TReturn }> & Partial<{ error: ErrorType }>;
```

### OutputStrategy type (`packages/squilo/src/pipes/output/strategies/types.ts`)

```ts
type OutputStrategy<T, TReturn, TOutput = void> = (data: ReadableStream<ExecutionResult<T, TReturn>>) => Promise<TOutput>;
```

### AuthStrategy type (`packages/squilo/src/pipes/auth/strategies/types.ts`)

```ts
type AuthStrategy = (config: ServerConfig) => config;
```

### TransformFunction type (`packages/squilo/src/pipes/transform/types.ts`)

```ts
type TransformFunction<TInput, TOutput> = (data: TInput) => TOutput | Promise<TOutput>;
```

### Progress bar
Disabled when `Bun.env.NODE_ENV === 'test'`. Uses `cli-progress`'s `SingleBar` with format: `{bar} {percentage}% | {value}/{total} | {database}`. Created by `Progress()` in `packages/squilo/src/pipes/shared/progress.ts` each time a run stream starts.

---

## Dependencies

### Core (`packages/squilo`)

| Dependency | Version | Purpose |
|---|---|---|
| `mssql` | ^12.2.0 | SQL Server driver |
| `@types/mssql` | ^9.1.8 | MSSQL types (prod dep) |
| `cli-progress` | ^3.12.0 | Terminal progress bars |
| `effect` | ^4.0.1 | Runner streams, retry/timeout/interruption (internal, not in public types) |

### Extensions

| Package | Dependencies |
|---|---|
| `@squilo/msal-auth-strategy` | `@azure/msal-node` ^3.8.0, `open` ^10.2.0 |
| `@squilo/xls-output-strategy` | `xlsx` (SheetJS CDN tarball: 0.20.3) |

### Dev (root)

| Dependency | Version |
|---|---|
| `@biomejs/biome` | 2.3.11 |
| `@tanstack/intent` | ^0.0.41 |
| `bunup` | ^0.16.10 |

### Dev (`packages/squilo`)

| Dependency | Version |
|---|---|
| `@faker-js/faker` | ^10.1.0 |
| `@types/bun` | latest |
| `@types/cli-progress` | ^3.11.6 |
| `testcontainers` | ^11.7.1 |

**Peer dep** (all packages): `typescript ^5.9.3`

---

## @tanstack/intent Skills System

14 skill files scaffolded in `packages/squilo/skills/` using `@tanstack/intent`. Skills are markdown files (`SKILL.md`) with YAML frontmatter and detailed instruction content. They document the pipeline API for AI coding agents to use when generating Squilo code.

### Skill list

| # | Skill | Type | Domain | Description |
|---|---|---|---|---|
| 1 | `connect-to-server` | core | core-pipeline | Configure `Server()` with host/port/encryption |
| 2 | `setup-authentication` | core | core-pipeline | SQL auth or Azure AD auth after `Server()` |
| 3 | `connect-to-databases` | core | core-pipeline | Single/array/query-based database discovery |
| 4 | `retrieve-data` | core | core-pipeline | Query across DBs, streaming, transactions |
| 5 | `execute-updates` | core | core-pipeline | UPDATE/INSERT/DELETE/DDL → `ExecutionError[]` |
| 6 | `transform-data` | core | core-pipeline | Post-retrieve TransformStream (expensive work after DB close) |
| 7 | `output-results` | core | core-pipeline | Consume stream with Merge/Json/Console/Xls |
| 8 | `handle-errors` | core | core-pipeline | SAFE_GUARD, error collection, error tuple pattern |
| 9 | `create-custom-auth-strategy` | core | extensibility | Implement custom `AuthStrategy` |
| 10 | `create-custom-output-strategy` | core | extensibility | Implement custom `OutputStrategy` |
| 11 | `integrate-honojs` | composition | integration | Wire Squilo to Hono HTTP routes |
| 12 | `setup-testcontainers` | composition | integration | Azure SQL Edge Docker containers for testing |
| 13 | `getting-started` | lifecycle | journeys | First script end-to-end onboarding |
| 14 | `generate-report` | lifecycle | journeys | Full report workflow: discover → retrieve → transform → output |

### Skill scaffolding artifacts (`skills/_artifacts/`)

| File | Content |
|---|---|
| `domain_map.yaml` | Library metadata, 4 domains (core-pipeline, extensibility, integration, journeys), 14 skill stubs |
| `skill_spec.md` | Detailed skill specification with "When to use", key APIs, wrong/correct patterns for each skill |
| `skill_tree.yaml` | Full catalog with slugs, types, descriptions, source references, `requires` relationships |

Skills reference source files via `sources` in frontmatter using the format `dodevs/Squilo:packages/squilo/src/...`.

---

## Test Infrastructure

### Test stack
- **Runner**: `bun:test` (`describe`, `it`, `test`, `expect`, `beforeAll`, `afterAll`, `mock`)
- **Container**: `testcontainers` with `mcr.microsoft.com/azure-sql-edge` Docker image
- **Wait strategy**: `Wait.forLogMessage('Recovery is complete')`, then polls until SQL Server accepts logins
- **Lifecycle**: container specs call `UseSqlServer(setup?)` (`test/container/container.ts`): starts the container in `beforeAll` with hook timeout `SQL_SERVER_TIMEOUT` (bunfig's `timeout` only applies to tests), runs `setup`, stops it in `afterAll`
- **Data**: `@faker-js/faker` for user generation (seed: 123)

### Test file structure

```
packages/squilo/test/
├── index.spec.ts                     # Integration: Retrieve + Execute across 5 DBs
├── connect.spec.ts                   # Connection overloads (single, array, concurrency, query discovery)
├── connection.spec.ts                # ConnectionPoolWrapper + TransactionWrapper disposal, deadlock surfaced as-is
├── runner.spec.ts                    # Runner with an in-memory Pool (no Docker): concurrency, SAFE_GUARD, discovery failure
├── pool.spec.ts                      # TransactionWrapper with a fake Transaction (no Docker): failing commit$ rolls back
├── transient.spec.ts                 # IsTransientError (no Docker)
├── transform.spec.ts                 # Transform pipe: async transform, property addition, value doubling
├── error-handling.spec.ts            # SAFE_GUARD behavior + timeout/abort/UnfinishedWorkError rolling back a real transaction
└── container/
    ├── container.ts                  # AzureSqlEdge factory, UseSqlServer, SQL_PASSWORD, SQL_SERVER_TIMEOUT, CONFIG helper
    ├── container.spec.ts             # Basic connectivity test
    └── setup/
        ├── databases.ts              # Creates 5 test DBs (TestDB1-5) + ClientsManager DB + Clients table
        └── users.ts                  # Creates Users table with indexes (IX_Users_Name, IX_Users_Email) + faker seed data

packages/xls-output-strategy/test/
└── xls.spec.ts                       # XlsOutputStrategy tests (separate/combined sheets, empty data, error sheets)
```

### Test databases
- `TestDB1`–`TestDB5`: Each has 10 faker-generated users (configurable via `quantity` option)
- `ClientsManager`: Contains `Clients` table with `DatabaseName` column — used for discovery query tests
- SA password: `YourStrong@Passw0rd`
- Progress bars: disabled in test env (`Bun.env.NODE_ENV === 'test'` check in `pipes/shared/progress.ts`)
- Docker-free specs: `runner.spec.ts`, `pool.spec.ts`, `transient.spec.ts`, and the output strategy specs (`merge.spec.ts`, `json.spec.ts`, `console.spec.ts`, `xls.spec.ts`), which use in-memory `ReadableStream` mocks

---

## Build & Run

```bash
bun test              # Run all tests (requires Docker)
bun run test:docker   # Run the suite in a Linux Bun container (hosts where Bun can't reach Docker, e.g. Windows)
bun run build         # Build all 3 packages with bunup
bun run test:watch    # Watch mode
bun run test:debug    # Debug mode
bun run format        # Biome format
```

Run single specs from the root so the root `bunfig.toml` applies: `bun test ./packages/squilo/test/connect.spec.ts`.

**Build output**: Each package's `dist/` contains ESM JS bundles + `.d.ts` declaration files with code splitting.

---

## Configuration Notes

- `.env` is gitignored; the only env var used is `SAFE_GUARD` (integer, default `1`)
- Biome: tabs + double quotes, recommended lint rules, organize imports on save
- `tsconfig.json`: `strict`, `noUncheckedIndexedAccess: true`, `isolatedDeclarations: true`, `noEmit: true`, `verbatimModuleSyntax: true`, `moduleResolution: "bundler"`
- `bunup.config.ts`: Uses `defineWorkspace()` for 3-package parallel build with `dts.splitting`

---

## Recent Git History (key commits)

```
849a68b chore: bump version to 0.8.0-beta.1
a0d0071 refactor(runner): drop unused error classes, speculative paths and extra comments
383c6ea docs(skills): describe the Effect runner and execution options
b670cb1 fix(connect): close the discovery connection after the query
8d4a0f1 build: add test:docker script for hosts where Bun can't reach Docker
7dc2532 test: stabilize the SQL Server container suite
a20bef8 fix(pool,runner): surface deadlocks as-is and stop hanging on open transactions
cfd27c0 feat(connect): add retry, timeout and abort signal execution options
ffba01e fix(pool): roll back when commit$ fails
3ce3bb0 refactor(runner): run pipeline on Effect streams
a919b98 fix(types): type Connect(string[]) callbacks with a single database
036419a feat!: restructure into Bun workspace monorepo with 3 packages
540a50c chore: bump version to 0.6.5
```

> **Note**: The repo has been restructured from a single-package layout (`src/`, `test/`) to a monorepo (`packages/squilo/src/`, `packages/msal-auth-strategy/`, `packages/xls-output-strategy/`). The current version is `0.8.0-beta.1` across all packages. The older git history (pre-0.7.0) reflects the pre-monorepo structure.

---

## Common Anti-Patterns / Gotchas

1. **Leaving a transaction open**: `const tx = await conn.transaction$()` without `await using` (or an un-awaited query) leaves the connection busy when the callback returns; that database fails with an `UnfinishedWorkError` and the connection is force-closed, rolling the transaction back.

2. **Confusing `.Execute()` with `.Retrieve()`**: Execute is terminal (returns `Promise<ExecutionError[]>` directly), Retrieve is streaming (returns `RetrieveChain` that must be consumed with `.Output()` or `.Transform().Output()`).

3. **Forgetting to destructure the error tuple**: Both `MergeOutputStrategy` and `JsonOutputStrategy` return `[ExecutionError[], result]`. Ignoring the first element silently drops error information.

4. **Forgetting concurrency limit**: Connecting to many databases without a concurrency limit opens all connections simultaneously, overwhelming SQL Server.

5. **Discovery query missing `Database` column**: The `ConnectionOptions.query` must return a column named `Database` — it's how the framework knows which databases to connect to.

6. **Transform for simple mapping**: Don't use `.Transform()` for basic mapping that can be done inline in the `.Retrieve()` callback. Transform is for expensive post-processing (file I/O, API calls, heavy computation) where you want DB connections released first.

7. **Mutating server config in auth strategies**: Always return a new object (`{...config, user, password}`), never mutate the input config.

8. **Not calling `commit$()` in transactions**: The `TransactionWrapper` auto-rolls back on `await using` disposal unless `commit$()` succeeded. Just doing `await transaction.commit()` (the base method) won't set the internal `committed` flag.

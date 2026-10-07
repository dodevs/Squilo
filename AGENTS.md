# AGENTS.md — Squilo

> Agent-focused technical context for AI coding agents working on this repository.
> This complements [README.md](./README.md) which provides human-facing documentation.

## Project Overview

**Squilo** is a **Bun-first TypeScript monorepo** for orchestrating SQL Server connections, authentication, and script execution across multiple databases. It targets multi-database scenarios: multi-tenant SaaS, batch jobs, migrations, reporting, and ETL pipelines.

- **Runtime**: Bun v1.2.20+ (uses `Bun.file()`, `Bun.write()`, `Bun.env`, `await using`)
- **Language**: TypeScript strict mode, ESNext, ESM only
- **Build**: `bunup` with workspace config (`bunup.config.ts`)
- **Linter/Formatter**: Biome 2.3.11 (tabs, double quotes)
- **Tests**: `bun:test` with `testcontainers` (Azure SQL Edge Docker image)
- **License**: MIT
- **Repo**: https://github.com/dodevs/Squilo

## Monorepo Structure

```
Squilo/
├── package.json              # Root workspace (private, workspaces: ["packages/*"])
├── bunup.config.ts           # Workspace build for all 3 packages
├── biome.json                # Biome config
├── tsconfig.json             # Root TypeScript config
├── bun.lock / bunfig.toml    # Bun package manager
├── packages/
│   ├── squilo/               # Core pipeline (published as "squilo")
│   │   ├── src/              # Pipeline stages, pool, strategies
│   │   ├── test/             # Integration tests (Azure SQL Edge container)
│   │   ├── skills/           # 14 @tanstack/intent SKILL.md files
│   │   └── dist/             # Build output
│   ├── msal-auth-strategy/   # Azure AD auth (published as "@squilo/msal-auth-strategy")
│   │   ├── src/              # msal.ts + index.ts
│   │   └── dist/
│   └── xls-output-strategy/  # Excel output (published as "@squilo/xls-output-strategy")
│       ├── src/              # xls.ts + index.ts
│       ├── test/             # xls.spec.ts
│       └── dist/
└── skills/_artifacts/        # @tanstack/intent scaffold artifacts (domain_map, skill_spec, skill_tree)
```

| Package | npm name | Description |
|---|---|---|
| `packages/squilo` | `squilo` | Core pipeline — Server, Auth, Connect, Retrieve, Execute, Transform, Output |
| `packages/msal-auth-strategy` | `@squilo/msal-auth-strategy` | Azure AD (Entra ID) interactive/silent authentication |
| `packages/xls-output-strategy` | `@squilo/xls-output-strategy` | Excel (.xlsx) output with separate or combined sheets |

## Setup Commands

```bash
# Install all workspace dependencies
bun install

# Build all packages
bun run build

# Build a specific package
cd packages/squilo && bun run build
cd packages/msal-auth-strategy && bun run build
cd packages/xls-output-strategy && bun run build

# Format code
bun run format
```

## Development Workflow

```bash
# Run all tests
bun run test

# Watch mode
bun run test:watch

# Debug mode
bun run test:debug

# Run tests for a specific package
cd packages/squilo && bun test

# Run a single test file
cd packages/squilo && bun test test/connect.spec.ts
cd packages/xls-output-strategy && bun test src/pipes/output/strategies/xls.spec.ts
```

Tests require Docker (see Testing section below).

## Core Architecture

### Fluent Chain Pipeline

The API is a **type-enforced fluent chain** — each step returns a constrained object that only exposes the next valid method(s). There are no runtime checks; the TypeScript type system enforces correctness at compile time.

```
Server(config) → .Auth(strategy) → .Connect(db|dbs|query) → .Retrieve(fn) or .Execute(fn) → [.Transform(fn)] → .Output(strategy)
```

### Pipeline Step Reference

| Step | Method | Input | Returns | Next |
|---|---|---|---|---|
| Server | `Server(config)` | `ServerConfig` (mssql config minus auth fields) | `ServerChain` | `.Auth(strategy)` |
| Auth | `.Auth(strategy)` | `AuthStrategy` function | `AuthenticationChain` | `.Connect(...)` |
| Connect | `.Connect(db)` | `string` | `ConnectionChain<string>` | `.Execute` or `.Retrieve` |
| Connect | `.Connect([dbs], options?)` | `string[]`, `number | ExecutionOptions` | `ConnectionChain<string>` | `.Execute` or `.Retrieve` |
| Connect | `.Connect(query, options?)` | `ConnectionOptions` (discovery query), `number | ExecutionOptions` | `ConnectionChain<T>` | `.Execute` or `.Retrieve` |
| Retrieve | `.Retrieve(fn)` | `(pool, T) => Promise<TReturn>` | `RetrieveChain<T, TReturn>` | `.Transform` or `.Output` |
| Execute | `.Execute(fn)` | `(pool, T) => Promise<void>` | `Promise<ExecutionError[]>` | *(terminal)* |
| Transform | `.Transform(fn)` | `TransformFunction<TInput, TOutput>` | `TransformChain<T, TOutput>` | `.Output(strategy)` |
| Output | `.Output(strategy)` | `OutputStrategy<T, TReturn, TOutput>` | `Promise<TOutput>` | *(terminal)* |

### Source File Map (`packages/squilo/src/`)

```
packages/squilo/src/
├── index.ts                        # Main exports: Server, SQL, types, strategies
├── pool/
│   └── index.ts                    # Pool, ConnectionPoolWrapper, TransactionWrapper
├── utils/
│   └── load-env.ts                 # SAFE_GUARD env var loader
└── pipes/
    ├── types.ts                    # Re-exports auth/types
    ├── server/
    │   ├── index.ts                # Server(config) → ServerChain
    │   └── types.ts                # ServerConfig, ServerChain
    ├── auth/
    │   ├── index.ts                # Auth(config)(strategy) → AuthenticationChain, creates Pool
    │   ├── types.ts                # AuthenticationChain (Connect overloads)
    │   └── strategies/
    │       ├── index.ts            # Exports UserAndPassword + AuthStrategy type
    │       ├── types.ts            # AuthStrategy = (config: ServerConfig) => config
    │       └── userAndPassword.ts  # SQL auth: UserAndPassword(user, pass)
    ├── connect/
    │   ├── index.ts                # Connect(pool) — single DB, array, or discovery query
    │   └── types.ts                # ConnectionChain, DatabaseConnection, DatabaseObject, ConnectionOptions
    ├── retrieve/
    │   ├── index.ts                # Retrieve — Runner stream exposed as a ReadableStream
    │   └── types.ts                # RetrieveChain (Transform | Output)
    ├── execute/
    │   └── index.ts                # Execute — runs fn per DB, collects errors
    ├── transform/
    │   ├── index.ts                # Transform — pipeThrough TransformStream
    │   └── types.ts                # TransformChain, TransformFunction
    ├── output/
    │   ├── index.ts                # Output — delegates to strategy
    │   └── strategies/
    │       ├── index.ts            # Exports Merge, Console, Json + OutputStrategy type
    │       ├── types.ts            # OutputStrategy<T, TReturn, TOutput>
    │       ├── merge.ts            # MergeOutputStrategy — flat-merge all results
    │       ├── json.ts             # JsonOutputStrategy — JSON file with configurable includes
    │       ├── console.ts          # ConsoleOutputStrategy — console.log each chunk
    │       ├── merge.spec.ts
    │       ├── json.spec.ts
    │       ├── console.spec.ts
    │       └── xls.spec.ts         # (spec for strategy moved to @squilo/xls-output-strategy)
    └── shared/
        ├── progress.ts             # cli-progress bar (silent when NODE_ENV=test)
        └── runner/
            ├── index.ts            # Runner — Effect Stream: per-DB acquire/release, sliding-window concurrency, SAFE_GUARD
            ├── transient.ts        # IsTransientError — default retry predicate
            └── types.ts            # RunStream, ExecutionResult, ExecutionError, RunnerError (ConnectionFailed/ExecutionFailed/TimedOut/Aborted)
```

### Key Types

```ts
// Auth strategy signature
type AuthStrategy = (config: ServerConfig) => config;

// Output strategy signature (receives a ReadableStream of ExecutionResult)
type OutputStrategy<T, TReturn, TOutput = void> = (
    data: ReadableStream<ExecutionResult<T, TReturn>>
) => Promise<TOutput>;

// Execution result (union of data and error)
type ExecutionResult<T, TReturn> = Execution<T> & Partial<ExecutionData<T, TReturn>> & Partial<ExecutionError<T>>;
type ExecutionError<T> = { database: T; error: ErrorType };

// ConnectionChain overloads
type ConnectionChain<T> = {
    Execute(fn: (connection: ConnectionPoolWrapper, database: T) => Promise<void>): Promise<ExecutionError<T>[]>;
    Retrieve<TResult>(fn: (connection: ConnectionPoolWrapper, database: T) => Promise<TResult>): RetrieveChain<T, TResult>;
};
```

### Main Exports (`packages/squilo/src/index.ts`)

```ts
export * from "./pipes/server";                     // Server
export * as SQL from "mssql";                       // Raw mssql access

// Types
export type { AuthStrategy };
export type { ServerConfig };
export type { OutputStrategy };
export type { ExecutionResult, ExecutionError, ErrorType };
export type { DatabaseObject, ExecutionOptions, RetryOptions, DurationInput };

// Built-in strategies
export { UserAndPassword };
export { MergeOutputStrategy, ConsoleOutputStrategy, JsonOutputStrategy };
export { IsTransientError };                      // default retry predicate
```

## Key Design Patterns

### 1. Pool Caching (`packages/squilo/src/pool/index.ts`)
The `Pool` factory creates a `Record<string, () => Promise<ConnectionPool>>` cache keyed by database name. When `.Connect("MyDB")` is called, it checks the cache. The pool's `close()` is patched to delete the cache entry. Errors also delete entries. The Pool is created once during `.Auth()` and shared across all `.Connect()` calls.

### 2. AsyncDisposable Pattern
`ConnectionPoolWrapper` wraps `ConnectionPool` with `Symbol.asyncDispose`. Use with `await using` for auto-close. Adds `transaction$()` method.
`TransactionWrapper` wraps `Transaction` with `Symbol.asyncDispose`. **Auto-rolls back** on disposal unless `commit$()` was called first, or SQL Server already aborted the transaction (deadlock victim: the original error surfaces, not a `SuppressedError`).
Both wrappers **extend the mssql object in place** (`new X(obj) === obj`) instead of copying it: mssql keeps updating the original (e.g. its `_aborted` flag), so a copy would go stale.

### 3. Streaming Architecture
Retrieve uses `ReadableStream` / `TransformStream` to stream results. `Transform` pipes through another `TransformStream`. The output strategy consumes the stream. This keeps memory low and allows processing results as they arrive.

### 4. SAFE_GUARD (`packages/squilo/src/utils/load-env.ts`)
Environment variable `SAFE_GUARD` limits how many database errors trigger before halting further connections. Default: `1`. Set to `0` to disable. The first `min(SAFE_GUARD, concurrent)` databases run one at a time; once the guard trips, databases that have not started are skipped (no result emitted) while in-flight executions finish.

### 5. Concurrency, Retry, Timeout and Cancellation
`.Connect(databases, options?)` takes a concurrency number or `ExecutionOptions`:
- `concurrent`: how many databases run in parallel, as a sliding window (a new database starts as soon as any running one finishes). Default is unbounded (all at once).
- `retry`: `number | { times, delay?, while? }`. Re-runs the callback on a fresh connection with exponential backoff; by default only `IsTransientError` errors (deadlock, throttling, dropped connection; it unwraps the `SuppressedError` from `await using`).
- `timeout`: per-database budget (retries included). Fails with a `TimeoutError` result.
- `signal`: `AbortSignal`. Not-started databases are skipped; in-flight ones fail with an `AbortError` result.

Timeout/abort interrupt the execution and the Runner calls `ForceClose` (`pool/index.ts`): it closes busy tedious connections at the socket level, so the query dies and SQL Server rolls back the open transaction. A plain `pool.close()` would hang forever while a transaction holds a connection (tarn waits for used resources).
The same check runs when a callback returns normally: if a connection is still busy (e.g. `const tx` instead of `await using tx`), the database fails with `UnfinishedWorkError` and the connection is force-closed, so its transaction is rolled back instead of hanging the run.

### 6. Dynamic Database Discovery
`ConnectionOptions` allows specifying a management database and a SQL query that returns rows with a `Database` column. Uses `DatabaseObject` type (`{ Database: string }`) for type-safe discovery.

## Built-in Strategies

### Auth Strategies
| Strategy | Package | Description |
|---|---|---|
| `UserAndPassword(user, pass)` | `squilo` | SQL Server username/password auth |
| `ActiveDirectoryAccessToken(config)` | `@squilo/msal-auth-strategy` | Azure AD (Entra ID) — silent then interactive |

### Output Strategies
| Strategy | Package | Streams | Description |
|---|---|---|---|
| `MergeOutputStrategy()` | `squilo` | Yes | Flat-merge all results into a single array |
| `JsonOutputStrategy(options?)` | `squilo` | Yes | Write JSON file (`includeEmpty`, `includeErrors` options) |
| `ConsoleOutputStrategy()` | `squilo` | Yes | `console.log` each chunk |
| `XlsOutputStrategy(options)` | `@squilo/xls-output-strategy` | No | Excel with separate or combined sheets |

## Testing

### Test Infrastructure

Tests use **`bun:test`** (built into Bun) with **testcontainers** (`v11.7.1`) to spin up an **Azure SQL Edge** Docker container. No external SQL Server required.

Test config in `bunfig.toml`:
```toml
[test]
timeout = 60000
coverage = true
coverageThreshold = { line = 0.7, function = 0.9, statement = 0.9 }
coverageDir = "./coverage"
coverageReporter = ["text", "lcov"]
```

### Test File Structure (`packages/squilo/test/`)

```
test/
├── index.spec.ts              # Integration: Retrieve + Execute across 5 DBs
├── connect.spec.ts            # Connection overloads (single, array, concurrency, discovery)
├── runner.spec.ts             # Runner with an in-memory Pool (no Docker): concurrency, SAFE_GUARD, discovery failure
├── connection.spec.ts         # ConnectionPoolWrapper + TransactionWrapper disposal
├── pool.spec.ts               # TransactionWrapper with a fake Transaction (no Docker): commit failure rolls back
├── transient.spec.ts          # IsTransientError (no Docker)
├── transform.spec.ts          # Transform pipe: async transform, property addition
├── error-handling.spec.ts     # SAFE_GUARD behavior + timeout/abort rolling back a real transaction
└── container/                 # Test container helpers
```

### Running Tests

```bash
# All tests (requires Docker running)
bun run test

# Specific test file (run from the root so the root bunfig.toml applies)
bun test ./packages/squilo/test/connect.spec.ts

# Inside a Linux Bun container, for hosts where Bun cannot reach Docker (Windows: named pipe)
bun run test:docker
bun run test:docker ./packages/squilo/test/connect.spec.ts

# Watch mode for TDD
bun run test:watch
```

Tests require Docker. The Azure SQL Edge image is pulled automatically by testcontainers on first run.

Container-backed specs use `UseSqlServer(setup?)` from `test/container/container.ts`: it starts SQL Server in `beforeAll` (waiting until logins work), runs `setup`, and stops it in `afterAll`. Hooks need an explicit timeout (`SQL_SERVER_TIMEOUT`) because the `timeout` in `bunfig.toml` only applies to tests. `runner.spec.ts`, `pool.spec.ts`, `transient.spec.ts` and the output strategy specs need no Docker.

## Code Style

### Biome Configuration (`biome.json`)
- **Indent**: tabs, width 2
- **Quotes**: double quotes (`"`)
- **Semicolons**: always
- **Trailing commas**: all (es5 compatible)
- **Line width**: 120
- **Bracket spacing**: true

### TypeScript Configuration (`tsconfig.json`)
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `isolatedDeclarations: true`
- `noEmit: true` (build handled by `bunup`)
- Module: `ESNext`, ModuleResolution: `bundler`

### Naming Conventions
- Files: `kebab-case.ts` (e.g., `user-and-password.ts`)
- Directories: `kebab-case` (e.g., `msal-auth-strategy`)
- Types/Interfaces: `PascalCase` (e.g., `ServerChain`, `ExecutionResult`)
- Functions/variables: `camelCase` (e.g., `connectionPool`)
- Spec files: `*.spec.ts` co-located with source or in `/test/`
- Barrel exports: `index.ts` in each directory

### Import Patterns
- Use relative imports within a package (`../connect/types`)
- Export types with `export type` for type-only exports
- Re-export via barrel `index.ts` files at each directory level
- Package entry point: `src/index.ts` → `dist/index.js`

## Build and Deployment

### Build (`bunup.config.ts`)

Uses `bunup` workspace build with per-package config:

```ts
// bunup.config.ts
defineWorkspace([
    { name: "squilo", root: "packages/squilo", config: { entry: ["src/index.ts"], dts: { ... } } },
    { name: "msal-auth-strategy", root: "packages/msal-auth-strategy", config: { entry: ["src/index.ts"], dts: { ... } } },
    { name: "xls-output-strategy", root: "packages/xls-output-strategy", config: { entry: ["src/index.ts"], dts: { ... } } },
], { format: "esm", target: "bun", sourcemap: "linked", splitting: true, exports: true })
```

Output: `dist/index.js` (ESM) + `dist/index.d.ts` (declarations) per package.

### Package Publishing
- All packages published to npm as public scoped/unscoped packages
- Only `dist/` is included in the npm tarball (`"files": ["dist"]`)
- Versions are `0.7.0-beta.1` (pre-release)
- Extension packages have `squilo` as a workspace peer dependency

## Extension Packages

### Creating Custom Strategies

**Auth Strategy** implements `(config: ServerConfig) => config` — takes a server config without auth, returns a config with auth fields filled in.

**Output Strategy** implements `(data: ReadableStream<ExecutionResult<T, TReturn>>) => Promise<TOutput>` — consumes the result stream and produces output.

The `@tanstack/intent` skills `create-custom-auth-strategy` and `create-custom-output-strategy` provide detailed guidance for implementing custom strategies.

### Extension Package Pattern
Each extension package:
1. Has `squilo` as a `peerDependency` (workspace:^0.7.0-beta.1)
2. Exports its strategy from a single `src/index.ts`
3. Builds with `bunup` via the workspace config
4. Publishes to npm under the `@squilo/` scope

## Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `SAFE_GUARD` | Max database errors before halting further connections | `1` (0 = disabled) |
| `.env` file | Loaded by Bun automatically (`Bun.env`) | — |

## @tanstack/intent Skills System

The project includes 14 `@tanstack/intent` skill files in `packages/squilo/skills/` that provide AI agents with task-specific guidance for the pipeline API:

| # | Skill | Domain |
|---|---|---|
| 1 | `connect-to-server` | core-pipeline |
| 2 | `setup-authentication` | core-pipeline |
| 3 | `connect-to-databases` | core-pipeline |
| 4 | `retrieve-data` | core-pipeline |
| 5 | `execute-updates` | core-pipeline |
| 6 | `transform-data` | core-pipeline |
| 7 | `output-results` | core-pipeline |
| 8 | `handle-errors` | core-pipeline |
| 9 | `create-custom-auth-strategy` | extensibility |
| 10 | `create-custom-output-strategy` | extensibility |
| 11 | `integrate-honojs` | integration |
| 12 | `setup-testcontainers` | integration |
| 13 | `getting-started` | journeys |
| 14 | `generate-report` | journeys |

Skills reference source files via `sources` in YAML frontmatter using format `dodevs/Squilo:packages/squilo/src/...`.

Install skills into your agent via:
```bash
npx @tanstack/intent@latest install
```

Scaffolding artifacts live in `skills/_artifacts/`:
- `domain_map.yaml` — 4 domains with 14 skill stubs
- `skill_spec.md` — detailed spec with APIs, correct/incorrect patterns
- `skill_tree.yaml` — full catalog with slugs, types, descriptions, dependencies

## Common Patterns & Pitfalls

### Correct Usage
```ts
// Fluent chain — must go in order
Server(config).Auth(strategy).Connect(db).Retrieve(fn).Output(strategy);

// Execute is terminal (no .Transform or .Output after)
Server(config).Auth(strategy).Connect(db).Execute(fn); // Promise<ExecutionError[]>

// Transform goes between Retrieve and Output
Server(config).Auth(strategy).Connect(db).Retrieve(fn).Transform(fn).Output(strategy);
```

### ExecutionResult Pattern
Results from Retrieve are always `ExecutionResult<T, TReturn>`, which is `{ database, data?, error? }`. Always check for `error` before using `data`:
```ts
.Retrieve(async (conn, db) => { ... })
.Transform((results) => {
    return results.filter(r => !r.error).map(r => r.data!);
})
```

### Connection Disposal
`ConnectionPoolWrapper` and `TransactionWrapper` automatically clean up via `await using`. The library handles pool lifecycle internally — do not manually close pools obtained from callbacks.

## Debugging & Troubleshooting

### Common Issues
- **Tests fail with connection errors**: Ensure Docker is running and the Azure SQL Edge container can start. Run `docker ps` to verify.
- **`Could not find a working container runtime strategy` on Windows**: Bun cannot use the Docker named pipe. Run `bun run test:docker` instead.
- **SAFE_GUARD errors**: If execution halts early, check the `SAFE_GUARD` env var. Set to `0` to disable.
- **Build errors**: Ensure `bun install` has been run and all workspace dependencies are resolved.
- **Type errors after adding new strategies**: Run `bun run build` in the package to regenerate declarations.
- **Coverage thresholds not met**: Check `bunfig.toml` for current thresholds (70% line, 90% function/statement).

# Review: Bun→Node Migration — Simplicity, Idioms & Type Safety

**Reviewed files** (git HEAD diff):
- `packages/squilo/src/pool/index.ts`
- `packages/squilo/src/pipes/output/strategies/json.ts`
- `packages/squilo/src/utils/load-env.ts`
- `packages/msal-auth-strategy/src/msal.ts`
- `packages/xls-output-strategy/src/xls.ts`
- Plus 42 other files with formatting-only or minor changes

**Review angle:** Simplicity, idiomatic code, structural friction  
**Date:** 2026-05-15

---

## Blocker

### B1. `import mssql from "mssql"` — no default export in `@types/mssql`

**File:** `packages/squilo/src/pool/index.ts:2`

```ts
import type { config } from "mssql";
import mssql from "mssql";
```

`@types/mssql@9.1.8` has **no `export default` and no `export =`**. It only has named exports (`export declare class ConnectionPool`, `export declare class Transaction`, `export interface config`, etc.). The `mssql` package itself is CJS (`module.exports = require('./lib/tedious')`) with no built-in types — it relies entirely on `@types/mssql`.

With the project's tsconfig:
- `verbatimModuleSyntax: true`
- `module: "Preserve"`
- `moduleResolution: "bundler"`

TypeScript in bundler mode *may* treat a CJS module's `module.exports` as the default import, making this work. But it's fragile — the types don't declare a default export, so `mssql` could resolve as `any` or cause a compile error depending on the TypeScript version and exact resolution strategy.

**Evidence:** The old code used clean named imports:
```ts
import { type config, ConnectionPool, Transaction } from 'mssql';
```

**Suggested fix:** Revert to named imports. The namespace prefix (`mssql.ConnectionPool`) adds noise without benefit in a file that uses `ConnectionPool` and `Transaction` extensively:
```ts
import { type config, ConnectionPool, Transaction } from "mssql";
```

If you must use a namespace import for some reason, use `import * as mssql from "mssql"` which is unambiguous.

**Verification needed:** Run `cd packages/squilo && npx tsc --noEmit` to check if TypeScript accepts the current `import mssql from "mssql"`.

---

## Fixed

*No fixes applied — this is a read-only review.*

---

## Correct

### C1. `load-env.ts` — clean, minimal simplification

**File:** `packages/squilo/src/utils/load-env.ts`

The migration from `Bun.env.SAFE_GUARD` → `process.env.SAFE_GUARD` is correct. The removal of the `StringEnv` type, `declare module "bun"` augmentation, and associated boilerplate is appropriate cleanup. The result is 10 lines — simple, readable, correct.

### C2. `msal.ts` — `readFile`/`writeFile` from `node:fs/promises` is correct

**File:** `packages/msal-auth-strategy/src/msal.ts:3`

```ts
import { readFile, writeFile } from "node:fs/promises";
```

- `readFile(cacheFilePath, "utf8")` — correctly returns `string` with encoding
- `writeFile(cacheFilePath, "")` — correct for creating empty file in the catch block
- `writeFile(cacheFilePath, data)` — correct for writing serialized cache
- Using `node:fs/promises` (async) rather than `node:fs` (sync) — correct for an async context

The migration is a clean 1:1 replacement: `Bun.file(path).text()` → `readFile(path, "utf8")`, `Bun.write(path, data)` → `writeFile(path, data)`.

### C3. `xls.ts` — `writeFile` from `node:fs/promises` is correct

**File:** `packages/xls-output-strategy/src/xls.ts:1`

```ts
import { writeFile } from "node:fs/promises";
```

Correct for writing a `Buffer` (xlsx output). `Bun.write(filename, buffer)` → `writeFile(filename, buffer)` is a clean replacement.

### C4. `Bun.env.NODE_ENV` → `process.env.NODE_ENV` in runner, retrieve, execute

**Files:**
- `packages/squilo/src/pipes/shared/runner/index.ts:55,66,71`
- `packages/squilo/src/pipes/retrieve/index.ts:43,52`
- `packages/squilo/src/pipes/execute/index.ts:33,42`

Clean replacement. `process.env` is the standard Node.js API.

### C5. `engines: "node >=22"` is correct

**Files:** All 3 `package.json` files

The codebase uses `await using` (in `pool/index.ts`) and `Symbol.asyncDispose`, which require Node.js 22+ without flags. The `>=22` engines field is accurate.

### C6. `@types/mssql` moved from `dependencies` to `devDependencies`

**File:** `packages/squilo/package.json`

Correct — `@types/mssql` is only needed at development time for type checking. The runtime `mssql` package stays in `dependencies`.

---

## Note

### N1. `json.ts` streaming: `createWriteStream` pattern works but has cleanup gap

**File:** `packages/squilo/src/pipes/output/strategies/json.ts:75-98`

```ts
try {
    const writer = createWriteStream(filename);
    writer.write("[");
    let first = true;
    for await (const chunk of result.pipeThrough(new DataProcessingStream())) {
        // ...write chunks...
    }
    const done = new Promise<void>((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
    });
    writer.write("]");
    writer.end();
    await done;
} catch (error) {
    console.error("Error writing JSON file:", error);
}
```

**Is the `createWriteStream` + `finish`/`error` promise pattern standard?** Yes — this is the canonical way to await a Node.js `WriteStream` completion. The promise is set up before `writer.end()` is called, which is correct since the event loop processes the `end()` before emitting `finish`.

**Could it be simpler?** Two options:

1. **`stream/promises.pipeline`** — Would require converting the Web `ReadableStream` to a Node `Readable`, then piping through a `Transform` that wraps/commas chunks into valid JSON. More ceremony, not simpler.

2. **`fs/promises.writeFile`** — Would buffer everything in memory. Defeats the streaming design.

The current approach is the right tradeoff. No simpler alternative preserves streaming.

**Minor improvement:** Add a `finally` to close the writer if the loop throws mid-stream:
```ts
try {
    const writer = createWriteStream(filename);
    try {
        // ...write loop...
    } finally {
        writer.destroy();
    }
} catch (error) { ... }
```
The original Bun code had the same gap, so this is not a regression — just an opportunity.

### N2. `json.ts` unnecessary template literal

**File:** `packages/squilo/src/pipes/output/strategies/json.ts:89`

```ts
writer.write(`${JSON.stringify(chunk, null, 2)}`);
```

The template literal wrapping `JSON.stringify` output adds nothing. Simplify to:
```ts
writer.write(JSON.stringify(chunk, null, 2));
```

### N3. Namespace import (`mssql.X`) adds verbosity — named imports are cleaner

**File:** `packages/squilo/src/pool/index.ts` (entire file)

Even if the default import resolves correctly, `mssql.ConnectionPool` and `mssql.Transaction` are used ~15 times throughout the file. Named imports (`ConnectionPool`, `Transaction`) are shorter, more idiomatic, and match how every other file in the codebase imports from mssql:

| File | Import style |
|---|---|
| `pool/index.ts` | `import mssql from "mssql"` ← inconsistent |
| `runner/index.ts` | `import type { MSSQLError, RequestError } from "mssql"` |
| `retrieve/index.ts` | `import type { ConnectionPool, Transaction } from "mssql"` |
| `connect/types.ts` | `import type { ConnectionPool } from "mssql"` |
| `server/types.ts` | `import type { config } from "mssql"` |
| All test files | `import { ConnectionPool } from "mssql"` / `import { connect } from "mssql"` |

### N4. `@types/bun` still in devDependencies

**File:** `packages/squilo/package.json`

`@types/bun` is still listed as a devDependency. The production source (`src/`) has zero `Bun.*` references. However, the test files (`json.spec.ts`, `xls.spec.ts`) still use `Bun.file()`, `Bun.$`, etc., so it's still needed for test compilation.

**Recommendation:** Keep for now (tests run under `bun:test`), but document this dependency and plan to migrate test assertions to Node.js APIs in a follow-up.

### N5. Mixed `node:` prefix usage

The codebase is inconsistent with `node:` prefix:

| File | Import | Prefix |
|---|---|---|
| `json.ts` | `import { createWriteStream } from "node:fs"` | `node:` |
| `msal.ts` | `import { readFile, writeFile } from "node:fs/promises"` | `node:` |
| `xls.ts` | `import { writeFile } from "node:fs/promises"` | `node:` |
| `msal.ts` | `import * as path from "path"` | none |
| `msal.ts` | `import { cwd } from "process"` | none |
| `runner/index.ts` | `import { Presets, SingleBar } from "cli-progress"` | n/a |

The `node:` prefix is preferred for Node.js built-in modules (clearer intent, future-proof). Consider adding `node:` to `path` and `process` imports for consistency. Low priority.

### N6. `squilo` description change vs AGENTS.md

**File:** `packages/squilo/package.json`

- **Old:** "Bun-first TypeScript library for orchestrating SQL Server connections, authentication, and script execution"
- **New:** "TypeScript multi-database pipeline orchestrator for SQL Server connections, authentication, and script execution"

The new description is more accurate for the Node.js target. However, **AGENTS.md** still says "Squilo is a **Bun-first TypeScript monorepo**" — this should be updated in a follow-up to stay consistent.

### N7. Formatting-only changes inflate the diff by ~47 files

**Files affected:** 42+ files have only biome formatting changes (tabs, semicolons, trailing commas, quote style). Key examples:
- `tsconfig.json` — array formatting (`["ESNext"]` on one line vs three)
- `packages/squilo/src/pipes/server/index.ts` — indentation only
- `packages/squilo/src/pipes/auth/strategies/types.ts` — trailing semicolon (1 char)
- All `*.spec.ts` test files — formatting only
- `packages/squilo/src/pipes/server/types.ts` — trailing semicolon (1 char)

**Recommendation:** If this is a PR, separate the biome formatting into its own commit first, then the substantive Bun→Node changes. This makes the review diff smaller (from 47 files to ~12 files) and clearly separates concerns.

---

## Summary

| Severity | Count | Items |
|---|---|---|
| **Blocker** | 1 | B1: `import mssql from "mssql"` has no default export in `@types/mssql` |
| **Fixed** | 0 | — |
| **Correct** | 6 | C1–C6: load-env, msal, xls, Bun.env→process.env, engines, @types/mssql placement |
| **Note** | 7 | N1–N7: cleanup gap, template literal, verbosity, @types/bun, node: prefix, AGENTS.md, formatting noise |

**Overall assessment:** The Bun→Node migration is largely correct and clean. The `load-env.ts`, `msal.ts`, and `xls.ts` changes are textbook replacements. The `json.ts` streaming change is the most complex and works correctly, though it could benefit from a `finally` block for robustness.

The **one blocker** is the `import mssql from "mssql"` pattern in `pool/index.ts`. Reverting to named imports (`import { ConnectionPool, Transaction, type config } from "mssql"`) is the safe, idiomatic fix. This eliminates the namespace prefix noise and guarantees type safety across all TypeScript resolution strategies.

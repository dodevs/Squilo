# CJS/ESM Interop Safety Audit — Squilo

**Date**: 2026-05-15  
**Reviewer**: Subagent (CJS/ESM interop audit)  
**Target**: All `from "external-pkg"` imports across `packages/*/src/**/*.ts`  
**Node.js version tested**: v22.12.0  

---

## Executive Summary

**1 BLOCKER found.** The `export * as SQL from "mssql"` pattern in `packages/squilo/src/index.ts` produces a broken namespace re-export under Node.js. All other CJS dependencies are safe.

---

## Per-Dependency Findings

### 1. mssql — namespace re-export via `export * as SQL from "mssql"`

**Status: 🔴 BLOCKER**

| Property | Value |
|---|---|
| Package type | `"type": "commonjs"` (CJS) |
| Entry point | `index.js` → `require('./lib/tedious')` |
| Export pattern | `module.exports = Object.assign({ConnectionPool, Transaction, ...}, base.exports)` |
| Source location | `packages/squilo/src/index.ts:2` |
| Dist output | `import * as SQL from "mssql"` (line 345) + `export { ..., SQL, ... }` (line 438) |

**Problem**: Under Node.js, `import * as SQL from "mssql"` creates a namespace object with only **2** detected named exports: `default` and `valueHandler`. The `cjs-module-lexer` cannot extract named exports from the `Object.assign({...}, base.exports)` pattern because the second argument is a variable reference.

**Runtime evidence** (Node.js v22.12.0):
```
import * as SQL from "mssql"
SQL keys: [ 'default', 'valueHandler' ]
SQL.ConnectionPool: undefined     ← BROKEN
SQL.connect: undefined            ← BROKEN
SQL.TYPES: undefined              ← BROKEN
SQL.default.ConnectionPool: function  ← works via .default
```

**Impact**: Any consumer doing `import { SQL } from "squilo"` followed by `SQL.ConnectionPool(...)`, `SQL.TYPES.NVarChar`, `SQL.Table(...)`, etc. will get `TypeError: SQL.ConnectionPool is not a constructor` or silent `undefined` at runtime.

**Fix**: Change to default import re-export:
```ts
// packages/squilo/src/index.ts — change:
export * as SQL from "mssql";

// to:
import mssql from "mssql";
export { mssql as SQL };
```

This makes `SQL` the default import (= `module.exports`), which is the full mssql object with all properties accessible:
```
import mssql from "mssql"
mssql.ConnectionPool: function  ✅
mssql.connect: function         ✅
mssql.TYPES: object             ✅
mssql.Table: function           ✅
```

**✅ FIX APPLIED** (2026-05-15): Changed source, rebuilt, verified at runtime under Node.js v22:
```
SQL.ConnectionPool: function  ✅
SQL.connect: function         ✅
SQL.TYPES: object             ✅
SQL.Table: function           ✅
SQL.Transaction: function     ✅
SQL.ISOLATION_LEVEL: object   ✅
SQL keys count: 88 (all exports accessible)
```

---

### 2. mssql — default import via `import mssql from "mssql"`

**Status: 🟢 SAFE**

| Property | Value |
|---|---|
| Source location | `packages/squilo/src/pool/index.ts:2` |
| Dist output | `import mssql from "mssql"` (line 41) |
| Usage | `new mssql.ConnectionPool(config)` (line 77) |

The default import from a CJS module resolves to `module.exports`, which is the full mssql object. `mssql.ConnectionPool`, `mssql.Transaction`, etc. all work correctly. **This was already fixed correctly.**

---

### 3. cli-progress — named imports `{ Presets, SingleBar }`

**Status: 🟢 SAFE**

| Property | Value |
|---|---|
| Package type | CJS (no `"type"` field) |
| Entry point | `./cli-progress.js` |
| Export pattern | `module.exports = { Bar, SingleBar, MultiBar, Presets, Format }` — static object literal |
| Source location | `packages/squilo/src/pipes/shared/runner/index.ts:1` |
| Dist output | `import { Presets, SingleBar } from "cli-progress"` |

cli-progress uses a simple `module.exports = { ... }` with static keys. `cjs-module-lexer` can reliably extract named exports from this pattern.

**Runtime evidence**: `Presets: object`, `SingleBar: function`, `Presets.legacy: object` ✅

---

### 4. xlsx — namespace import `import * as XLSX from "xlsx"`

**Status: 🟢 SAFE**

| Property | Value |
|---|---|
| Package type | Dual (CJS + ESM) |
| Entry point | `exports["."].import: "./xlsx.mjs"`, `exports["."].require: "./xlsx.js"` |
| Source location | `packages/xls-output-strategy/src/xls.ts:2` |
| Dist output | `import * as XLSX from "xlsx"` |

xlsx has a proper `exports` field with an ESM entry point (`xlsx.mjs`). Node.js resolves the `import` condition and uses the ESM module directly. No CJS interop involved.

**Runtime evidence**: `XLSX.utils: object`, `XLSX.readFile: function`, `XLSX.writeFile: function` ✅

---

### 5. @azure/msal-node — named imports `{ PublicClientApplication, LogLevel, ... }`

**Status: 🟢 SAFE**

| Property | Value |
|---|---|
| Package type | `"type": "module"` (ESM) |
| Entry point | `exports["."].import.default: "./dist/index.mjs"` |
| Source location | `packages/msal-auth-strategy/src/msal.ts:3-11` |
| Dist output | `import { LogLevel, PublicClientApplication } from "@azure/msal-node"` |

Native ESM package with proper `exports` field. Named imports resolve directly to the ESM entry point.

**Runtime evidence**: `PublicClientApplication: function`, `LogLevel: object` ✅

---

### 6. open — dynamic import `await import("open")`

**Status: 🟢 SAFE**

| Property | Value |
|---|---|
| Package type | `"type": "module"` (ESM) |
| Entry point | `exports.default: "./index.js"` |
| Source location | `packages/msal-auth-strategy/src/msal.ts:108` |
| Dist output | `const { default: open } = await import("open")` |

Native ESM package. Dynamic import with destructured default works correctly.

**Runtime evidence**: `open default: function` ✅

---

### 7. Node.js built-ins (`path`, `node:fs`, `node:fs/promises`, `process`)

**Status: 🟢 SAFE**

All built-in modules are imported with standard patterns (`import * as path`, `import { readFile, writeFile }`, `import { cwd }`, `import { createWriteStream }`). These are always available in Node.js ESM.

---

## Additional Observations

### A. Test files import mssql named exports directly

Multiple test files use `import { ConnectionPool } from "mssql"`, `import { connect, NVarChar, Table } from "mssql"`, etc. These currently run under Bun (`bun:test`), which has its own CJS interop that handles this correctly.

**Risk**: If tests are ever ported to run under Node.js, these named imports from mssql would fail the same way as the `export * as SQL` pattern. Not a blocker today, but worth noting for future test migration.

**Affected files**:
- `test/connection.spec.ts:2` — `import { ConnectionPool } from "mssql"`
- `test/container/container.spec.ts:2` — `import { connect, type ConnectionPool } from "mssql"`
- `test/container/setup/databases.ts:1` — `import { Bit, connect, NVarChar, Table } from "mssql"`
- `test/container/setup/users.ts:2` — `import { connect, NVarChar, Table } from "mssql"`

### B. Dead CJS interop helpers in msal-auth-strategy dist

The `packages/msal-auth-strategy/dist/index.js` includes `__toESM` and `__require = createRequire(import.meta.url)` helpers. These appear unused — all imports in that package are from ESM sources or Node.js builtins. Likely emitted by bunup's template but harmless.

### C. All `import type` from mssql are erased correctly

Type-only imports (`import type { config } from "mssql"`, `import type { ConnectionPool } from "mssql"`, etc.) are correctly stripped from the dist output (0 `import type` statements found in `packages/squilo/dist/index.js`). No CJS interop concern.

---

## Dependency Module Type Summary

| Dependency | Module Type | Import Pattern | CJS Interop Needed? | Status |
|---|---|---|---|---|
| mssql | CJS | `import mssql from "mssql"` (default) | Yes (default only) | ✅ Safe |
| mssql | CJS | `export * as SQL from "mssql"` (namespace) | Yes (fails) | 🔴 **BLOCKER** |
| cli-progress | CJS | `import { Presets, SingleBar }` (named) | Yes (works) | ✅ Safe |
| xlsx | Dual ESM/CJS | `import * as XLSX` (namespace) | No (ESM entry) | ✅ Safe |
| @azure/msal-node | ESM | `import { ... }` (named) | No | ✅ Safe |
| open | ESM | `await import("open")` (dynamic) | No | ✅ Safe |

---

## Recommended Fix

**✅ APPLIED** — Single change in `packages/squilo/src/index.ts` (line 2):

```diff
- export * as SQL from "mssql";
+ import mssql from "mssql";
+ export { mssql as SQL };
```

### Verification (completed)

1. Source changed in `packages/squilo/src/index.ts`
2. Rebuilt with `bun run build` — 0 errors
3. Runtime verified under Node.js v22.12.0:
   - `SQL.ConnectionPool: function` ✅
   - `SQL.connect: function` ✅
   - `SQL.TYPES: object` ✅
   - `SQL.Table: function` ✅
   - `SQL.Transaction: function` ✅
   - `SQL.ISOLATION_LEVEL: object` ✅
   - 88 total exports accessible ✅
4. Dist output now uses `import mssql from "mssql"` (default import) instead of `import * as SQL from "mssql"` (namespace import)
5. `.d.ts` output correctly types `SQL` as the full mssql module

### What changed

- `packages/squilo/src/index.ts` — replaced `export * as SQL from "mssql"` with `import mssql from "mssql"; export { mssql as SQL }`
- `packages/squilo/dist/index.js` — now has `import mssql2 from "mssql"` (default) instead of `import * as SQL from "mssql"` (namespace)
- `packages/squilo/dist/index.d.ts` — now has `import mssql2 from "mssql"; export { mssql2 as SQL }` (correct type)

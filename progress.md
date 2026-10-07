# Progress

## Status
In Progress

## Tasks
- [x] Worker 2: Replace Bun.file() and Bun.write() with Node.js fs equivalents
  - [x] packages/squilo/src/pipes/output/strategies/json.ts → createWriteStream from node:fs
  - [x] packages/msal-auth-strategy/src/msal.ts → readFile/writeFile from node:fs/promises
  - [x] packages/xls-output-strategy/src/xls.ts → writeFile from node:fs/promises

## Files Changed
- packages/squilo/src/pipes/output/strategies/json.ts — added `createWriteStream` import, replaced Bun.file()/writer() pattern
- packages/msal-auth-strategy/src/msal.ts — added `readFile`/`writeFile` import, replaced 3 Bun API calls
- packages/xls-output-strategy/src/xls.ts — added `writeFile` import, replaced Bun.write() call
- [x] Worker 3: Build config + package.json metadata updates
  - [x] bunup.config.ts: `target: "bun"` → `target: "node"` (global defaults)
  - [x] packages/squilo/package.json: updated description, replaced "bun" keyword with "nodejs", added engines
  - [x] packages/msal-auth-strategy/package.json: removed "bun" keyword, added engines
  - [x] packages/xls-output-strategy/package.json: removed "bun" keyword, added engines
  - [x] packages/squilo/package.json: moved @types/mssql from dependencies to devDependencies

## Notes
- All `grep "Bun\."` audits on edited files return zero matches.
- Streaming behavior in json.ts preserved: createWriteStream has same .write()/.end() API as Bun file writer.
- All package.json files formatted with biome for consistency.
- Workers 1 (Bun.env → process.env) still pending.

## Review: CJS/ESM Interop Safety Audit (Worker 5)
- [x] Audited all external package imports across 3 packages
- [x] BLOCKER FOUND & FIXED: `export * as SQL from "mssql"` in squilo/src/index.ts
  - Problem: `import * as SQL from "mssql"` under Node.js only exposes `default` and `valueHandler` as named exports (cjs-module-lexer can't parse `Object.assign({...}, base.exports)` chain)
  - Result: `SQL.ConnectionPool`, `SQL.TYPES`, etc. were `undefined` under Node.js
  - Fix: Changed to `import mssql from "mssql"; export { mssql as SQL }` — SQL now = full mssql module (88 exports accessible)
  - Verified: runtime test under Node.js v22.12.0 confirms all exports accessible
- [x] cli-progress: SAFE — uses `module.exports = { ... }` static object literal (cjs-module-lexer detects)
- [x] xlsx: SAFE — has `exports` field with ESM entry point (`xlsx.mjs`)
- [x] @azure/msal-node: SAFE — `type: "module"` with proper ESM entry
- [x] open: SAFE — dynamic import, `type: "module"`
- [x] All `import type` from mssql correctly erased from dist (0 type-only imports in dist)
- [x] Test files import mssql named exports directly — safe under Bun but would fail under Node.js (future risk)
- Full report: handoff/review-cjs-interop.md

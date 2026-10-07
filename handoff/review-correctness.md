# Review: Bun → Node.js Compatibility Changes (Correctness & Regressions)

**Reviewer:** review-correctness subagent  
**Date:** 2026-05-15  
**Scope:** All 14 semantic-change files in git HEAD working tree  

---

## 1. `Bun.env.SAFE_GUARD → process.env.SAFE_GUARD` (load-env.ts)

**File:** `packages/squilo/src/utils/load-env.ts` (lines 7–8)

```ts
// OLD:  const SAFE_GUARD = Number.parseInt(Bun.env.SAFE_GUARD || '1', 10);
// NEW:  const SAFE_GUARD = Number.parseInt(process.env.SAFE_GUARD || "1", 10);
```

**Verdict: ✅ CORRECT — identical runtime behavior**

- `Bun.env.SAFE_GUARD` and `process.env.SAFE_GUARD` both return `string | undefined`.
- `Number.parseInt` was already used (not `Bun.peek` or any Bun-specific parser), so the conversion is identical.
- The `'1'` default fallback is preserved.
- The `StringEnv` / `declare module "bun"` type augmentation was removed — it was only needed for TypeScript type-safety on `Bun.env` and has no runtime effect.
- `SAFE_GUARD = "0"` still disables the guard (tested by error-handling.spec.ts).

---

## 2. `Bun.env.NODE_ENV → process.env.NODE_ENV` (runner, retrieve, execute)

**Files:**
- `packages/squilo/src/pipes/shared/runner/index.ts` (lines 45, 51, 57)
- `packages/squilo/src/pipes/retrieve/index.ts` (lines 39, 49)
- `packages/squilo/src/pipes/execute/index.ts` (lines 35, 45)

**Verdict: ✅ CORRECT — identical runtime behavior**

- In Bun, `Bun.env` is the same object as `process.env`. Both return the same value for `NODE_ENV`.
- In Node.js, `process.env.NODE_ENV` is the standard way.
- The `"test"` string comparison is identical.
- Test files were already using `process.env` (not `Bun.env`) before this change — confirmed in connect.spec.ts and error-handling.spec.ts history.

---

## 3. `Bun.file().text() → readFile(path, "utf8")` (msal.ts)

**File:** `packages/msal-auth-strategy/src/msal.ts` (lines 30–37)

```ts
// OLD:
const cacheFile = await Bun.file(cacheFilePath).text();
// NEW:
const cacheFile = await readFile(cacheFilePath, "utf8");
```

**Verdict: ✅ CORRECT — identical runtime behavior**

- Verified empirically: `Bun.file('/nonexistent').text()` throws `ENOENT`, same as `readFile('/nonexistent', 'utf8')`.
- Both return `string` on success.
- In the catch block, both old (`Bun.write`) and new (`writeFile`) create the cache file identically.
- `Bun.write(path, "")` and `writeFile(path, "")` are semantically equivalent for string content.

**No edge case gap:** Both code paths hit the catch block on missing/corrupt files, create an empty cache file, and deserialize an empty string. ✅

---

## 4. `Bun.file().writer() → createWriteStream` (json.ts)

**File:** `packages/squilo/src/pipes/output/strategies/json.ts` (lines 84–101)

```ts
// OLD:
const file = Bun.file(filename);
const writer = file.writer();
writer.write('[');
// ... streaming loop ...
writer.write(']');
writer.end();
// ← function returns BEFORE file is guaranteed flushed

// NEW:
const writer = createWriteStream(filename);
writer.write("[");
// ... streaming loop ...
const done = new Promise<void>((resolve, reject) => {
    writer.on("finish", resolve);
    writer.on("error", reject);
});
writer.write("]");
writer.end();
await done;  // ← waits for file to be fully flushed
```

**Verdict: ✅ CORRECT (improved correctness)**

**Key analysis:**
1. **`done` promise is correct and cannot deadlock.** The `finish` event fires on successful completion; the `error` event fires on failure. Events are registered BEFORE `writer.end()` is called, so no events are missed.
2. **No backpressure issue.** `createWriteStream.write()` can return `false` when internal buffer is full, but the for-await loop naturally provides pacing. The JSON chunks are typically small.
3. **The `await done` actually FIXES a latent bug in the old code.** Bun's `FileWriter.end()` returns `void` (synchronous fire-and-forget). The old code returned the filename without confirming the file was fully written. With Node.js `createWriteStream`, the `await done` ensures the file is complete before returning.

**No deadlock risk:** If `writer.write("]")` or `writer.end()` triggers an error, the `error` event fires (not `finish`), and the promise rejects, which is caught by the surrounding `try/catch`. ✅

---

## 5. `Bun.write() → writeFile()` (msal.ts after, xls.ts)

**Files:**
- `packages/msal-auth-strategy/src/msal.ts` (line 49)
- `packages/xls-output-strategy/src/xls.ts` (line 210)

**Verdict: ✅ CORRECT — identical runtime behavior**

- `Bun.write(path, string)` and `writeFile(path, string)` are both async, both create/overwrite files.
- `Bun.write(path, buffer)` and `writeFile(path, buffer)` — both accept `Buffer`.
- The xls.ts `if (workbook.SheetNames.length)` guard was **already present** in the old code — NOT a new behavioral change. Only `Bun.write` → `writeFile` is the change.

---

## 6. mssql CJS Interop Fix (pool/index.ts)

**File:** `packages/squilo/src/pool/index.ts` (lines 1–2)

```ts
// OLD:
import { type config, ConnectionPool, Transaction } from 'mssql';

// NEW:
import type { config } from "mssql";
import mssql from "mssql";
```

Then `ConnectionPool` → `mssql.ConnectionPool`, `Transaction` → `mssql.Transaction` throughout.

**Verdict: ✅ CORRECT — necessary and proper for Node.js ESM+CJS interop**

- `mssql` is CJS (`"type": "commonjs"`, `module.exports = require('./lib/tedious')`).
- Named imports from CJS in ESM (`import { ConnectionPool } from 'mssql'`) rely on Node.js static analysis of CJS exports, which can be unreliable.
- Default import (`import mssql from 'mssql'`) reliably gets `module.exports`, then `mssql.ConnectionPool` works.
- All other mssql imports in the codebase are `import type` (erased at compile time) — no runtime interop needed for those.
- No leftover bare `ConnectionPool` or `Transaction` runtime references. Verified all 7 files with mssql imports.

---

## 7. `target: "bun" → target: "node"` (bunup.config.ts)

**File:** `bunup.config.ts` (line 32)

**Verdict: ✅ CORRECT — but enforces Node.js 22+ requirement**

- Output format remains `esm` — correct for Node.js with `"type": "module"`.
- `engines.node >= 22` in all package.json files covers:
  - `Symbol.asyncDispose` / `await using` support (runner/index.ts line 48)
  - Modern ESM features used in the output
- `export * as SQL from "mssql"` (index.ts) — namespace re-export works with bundler CJS interop for Node.js target.

---

## 8. `@types/mssql` moved from dependencies → devDependencies

**File:** `packages/squilo/package.json`

**Verdict: ⚠️ WARNING — needs verification after rebuild**

The current `dist/index.d.ts` (from prior build) contains:

```ts
import { config as config3 } from "mssql";
import { ConnectionError, TransactionError, ... } from "mssql";
import mssql from "mssql";
```

These are **external type references** to `mssql` — NOT inlined. The `dts: { resolve: ["mssql", /^@types\//] }` in bunup config *should* inline these types, but the current dist shows they aren't.

**Risk:** After building, if the generated d.ts still has external `from "mssql"` type imports, TypeScript consumers will fail to resolve them because:
- `mssql` ships NO built-in types (verified: no `.d.ts` in `node_modules/mssql/`)
- `@types/mssql` is no longer a transitive dependency of `squilo`

**Action required:** After running `bun run build`, verify the new `dist/index.d.ts` does NOT contain bare `from "mssql"` imports (i.e., types are inlined). If they're still external, either:
- Move `@types/mssql` back to `dependencies`, OR
- Ensure bunup's `resolve` option correctly inlines mssql types in the d.ts output

---

## 9. Test Files (connect.spec.ts, error-handling.spec.ts)

**Files:**
- `packages/squilo/test/connect.spec.ts`
- `packages/squilo/test/error-handling.spec.ts`

**Verdict: ✅ FORMATTING ONLY — no behavioral changes**

Both files' changes are purely:
- Indentation: 2-space → tab
- String quotes: single → double
- Line wrapping / trailing commas

Still uses `bun:test`, `mock.module()`, and Bun-specific test APIs. Tests can only run under Bun runtime. This is expected — test infrastructure migration is separate from production code migration.

---

## 10. Remaining `Bun.*` References in Production Source

**Verdict: ✅ CLEAN — zero `Bun.*` references in production source**

Verified via grep: the only remaining `Bun.*` usage is in test files:
- `json.spec.ts`: 10 uses (`Bun.file()`, `Bun.$`)
- `xls.spec.ts`: 8 uses (`Bun.file()`)

All 14 production source files have been properly migrated.

---

## 11. Minor Cleanup: Unused Import in retrieve/index.ts

**File:** `packages/squilo/src/pipes/retrieve/index.ts` (line 1)

```ts
import type { ConnectionPool, Transaction } from "mssql";
```

`ConnectionPool` and `Transaction` are imported but **never used** in this file. Only `ConnectionPoolWrapper` from `../../pool` is used.

**Verdict: ℹ️ INFO — pre-existing dead code, not introduced by this change.** No functional impact since it's a type-only import (erased at compile time). Consider removing in a follow-up cleanup.

---

## Summary Table

| # | File / Change | Severity | Verdict |
|---|---|---|---|
| 1 | load-env.ts: `Bun.env` → `process.env` | ✅ | Identical behavior |
| 2 | runner/retrieve/execute: `Bun.env.NODE_ENV` → `process.env.NODE_ENV` | ✅ | Identical behavior |
| 3 | msal.ts: `Bun.file().text()` → `readFile` | ✅ | Identical (both throw ENOENT on missing) |
| 4 | json.ts: `Bun.file().writer()` → `createWriteStream` | ✅ | Correct; `await done` actually improves correctness |
| 5 | msal.ts/xls.ts: `Bun.write()` → `writeFile()` | ✅ | Identical behavior |
| 6 | pool/index.ts: mssql CJS default import | ✅ | Correct CJS interop for Node.js |
| 7 | bunup.config.ts: `target: "node"` | ✅ | Correct; requires Node.js 22+ |
| 8 | **`@types/mssql` moved to devDependencies** | **⚠️ WARNING** | **Verify d.ts inlining after rebuild** |
| 9 | Test files: formatting changes | ✅ | No behavioral change |
| 10 | Production source: no remaining `Bun.*` | ✅ | Clean |
| 11 | retrieve/index.ts: unused mssql type import | ℹ️ INFO | Pre-existing, no impact |

---

## Recommended Next Steps

1. **[BLOCKER verification]** Run `bun run build` and inspect the new `dist/index.d.ts`. If it still has `from "mssql"` external type imports, move `@types/mssql` back to `dependencies` or fix the dts resolve configuration.
2. **[Optional cleanup]** Remove unused `import type { ConnectionPool, Transaction } from "mssql"` in `retrieve/index.ts`.
3. **[Document]** Add a note to README or CHANGELOG that squilo now requires Node.js 22+ (was Bun-only).

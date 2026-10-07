# Worker 2: File I/O Bun API Replacements

## Files Edited

### 1. packages/squilo/src/pipes/output/strategies/json.ts
- **Added import**: `import { createWriteStream } from "node:fs";`
- **Replaced**: `const file = Bun.file(filename); const writer = file.writer();` → `const writer = createWriteStream(filename);`
- **API mapping**: Bun's `file.writer()` → Node.js `createWriteStream(filename)`. Both support `.write(chunk)` and `.end()` with the same synchronous call pattern. The streaming JSON write loop is unchanged.

### 2. packages/msal-auth-strategy/src/msal.ts
- **Added import**: `import { readFile, writeFile } from "node:fs/promises";`
- **Replaced**: `await Bun.file(cacheFilePath).text()` → `await readFile(cacheFilePath, "utf8")` (line ~24)
- **Replaced**: `await Bun.write(cacheFilePath, "")` → `await writeFile(cacheFilePath, "")` (line ~27)
- **Replaced**: `await Bun.write(cacheFilePath, cacheContext.tokenCache.serialize())` → `await writeFile(cacheFilePath, cacheContext.tokenCache.serialize())` (line ~35)

### 3. packages/xls-output-strategy/src/xls.ts
- **Added import**: `import { writeFile } from "node:fs/promises";`
- **Replaced**: `await Bun.write(filename, buffer)` → `await writeFile(filename, buffer)` (line ~153)

## Validation
- `grep "Bun\."` on all 3 edited files returns 0 matches.
- No functional changes: all replacements use Node.js built-ins with equivalent semantics.

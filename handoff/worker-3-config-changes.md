# Worker 3: Build Config + Package.json Metadata Changes

## Changes Made

### 1. bunup.config.ts — Build Target
- **Change**: `target: "bun"` → `target: "node"` (line 32, global defaults)
- **Impact**: All 3 packages now produce Node.js-compatible ESM output

### 2. packages/squilo/package.json
- **description**: Removed "Bun-first" → "TypeScript multi-database pipeline orchestrator for SQL Server connections, authentication, and script execution"
- **keywords**: Removed "bun", added "nodejs"
- **engines**: Added `{"node": ">=22"}`
- **@types/mssql**: Moved from `dependencies` to `devDependencies` (types-only package, should not be published)

### 3. packages/msal-auth-strategy/package.json
- **keywords**: Removed "bun"
- **engines**: Added `{"node": ">=22"}`

### 4. packages/xls-output-strategy/package.json
- **keywords**: Removed "bun"
- **engines**: Added `{"node": ">=22"}`

## Verification

| Check | Result |
|-------|--------|
| bunup.config.ts target | `"node"` ✅ |
| All 3 packages have engines | `node >=22` ✅ |
| No "bun" in any package keywords | Confirmed ✅ |
| squilo description updated | No "Bun-first" ✅ |
| @types/mssql in devDependencies | Confirmed ✅ |
| Files formatted with biome | All 61 files formatted ✅ |

## Files Changed
- `bunup.config.ts`
- `packages/squilo/package.json`
- `packages/msal-auth-strategy/package.json`
- `packages/xls-output-strategy/package.json`

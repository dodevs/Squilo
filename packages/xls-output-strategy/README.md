# @squilo/xls-output-strategy

![npm version](https://img.shields.io/npm/v/@squilo/xls-output-strategy)
![bun compatible](https://img.shields.io/badge/bun-v1.2.20%2B-blue)
![license](https://img.shields.io/github/license/dodevs/Squilo)

## Package Overview

Excel (.xlsx) output strategy for [Squilo](https://www.npmjs.com/package/squilo) data pipelines. Supports separate sheets per database or a single combined sheet with row grouping. Built on [SheetJS](https://sheetjs.com/).

## Installation

```bash
bun add squilo @squilo/xls-output-strategy
```

## Usage

### Separate Sheets (Default)

Each database gets its own sheet, added in the order the databases finish (completion order):

```ts
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";

const [errors, filename] = await LocalServer
    .Connect(["DB1", "DB2"])
    .Retrieve(async (conn) => {
        const result = await conn.query`SELECT * FROM Users`;
        return result.recordset;
    })
    .Output(XlsOutputStrategy());

console.log(`Excel saved to: ${filename}`);
```

### Combined Sheet

All data merged into a single sheet with a `database` column:

```ts
const [errors, filename] = await LocalServer
    .Connect(["DB1", "DB2"])
    .Retrieve(async (conn) => {
        const result = await conn.query`SELECT * FROM Users`;
        return result.recordset;
    })
    .Output(XlsOutputStrategy(true)); // combineSheets = true
```

The combined sheet uses Excel row grouping (outline levels) so you can collapse/expand each database's data.

## Parameters

`XlsOutputStrategy(combineSheets?, includeEmpty?, includeErrors?)`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `combineSheets` | `boolean` | `false` | Merge all data into a single sheet with a `database` column and row grouping |
| `includeEmpty` | `boolean` | `true` | Include databases that returned no data (shown as a sheet with a "No data available" message) |
| `includeErrors` | `boolean` | `false` | Embed errors in an "Errors" sheet. When `true`, return type changes to `string` only |

## Return Types

**Default (`includeErrors: false`):**
```ts
const [errors, filename] = await chain.Output(XlsOutputStrategy());
// Type: [ExecutionError[], string]
```

**With `includeErrors: true`:**
```ts
const filename = await chain.Output(XlsOutputStrategy(false, true, true));
// Type: string (errors are embedded in the "Errors" sheet)
```

## Filename

Output files are named automatically using the script filename plus a timestamp:

```
<ScriptName>-<timestamp>.xlsx
```

For example, `report-users-1699999999999.xlsx`.

## Dependencies

- `xlsx` (SheetJS) — Excel read/write
- `squilo` — Peer dependency (the core pipeline library)

## Related

- [squilo](https://www.npmjs.com/package/squilo) — Core pipeline library
- [@squilo/msal-auth-strategy](https://www.npmjs.com/package/@squilo/msal-auth-strategy) — Azure AD authentication

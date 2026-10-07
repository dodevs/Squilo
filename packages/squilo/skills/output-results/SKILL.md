---
name: output-results
description: >
  Consume Retrieve stream with Output(strategy). Built-in: MergeOutputStrategy
  (flat array), JsonOutputStrategy (file with includeEmpty/includeErrors),
  ConsoleOutputStrategy (log each chunk). Excel via XlsOutputStrategy from
  @squilo/xls-output-strategy with separate/combined sheets. Returns
  [ExecutionError[], result] tuple — always destructure.
type: core
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/output/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/merge.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/json.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/console.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/types.ts"
  - "dodevs/Squilo:packages/xls-output-strategy/src/xls.ts"
---

# Squilo — Output Results

Consume the stream from `.Retrieve()` with an output strategy. All built-in strategies are in the core `squilo` package. Excel output requires `@squilo/xls-output-strategy`.

## Setup

Merge all results into a flat array:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, allUsers] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

console.log(`Found ${allUsers.length} users`);
```

## Core Patterns

### Write results to JSON file

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

const [errors, filename] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(JsonOutputStrategy());

console.log(`Results written to ${filename}`);
```

`JsonOutputStrategy()` writes a JSON file. Filename is auto-derived from `process.argv[1]` + timestamp.

### JSON file excluding empty results but including errors

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

// includeEmpty=false: skip databases with no data
// includeErrors=true: embed errors in JSON, return only filename
const filename = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(JsonOutputStrategy(false, true));

console.log(`Results written to ${filename}`);
```

With `includeErrors: true`, the return type changes from `[ExecutionError[], string]` to `string` (filename only). Errors are embedded in the JSON file.

### Excel output with separate sheets per database

```ts
import { Server, UserAndPassword } from "squilo";
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";

const [errors, filename] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(XlsOutputStrategy());

console.log(`Excel written to ${filename}`);
```

Each database gets its own sheet. Sheet names are truncated to 31 characters (Excel limitation).

### Excel output with combined sheet and row grouping

```ts
import { Server, UserAndPassword } from "squilo";
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";

const [errors, filename] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(XlsOutputStrategy(true, true, false));
// combineSheets=true, includeEmpty=true, includeErrors=false
```

Combined sheet adds a `database` column and groups rows per database with Excel row grouping.

## Common Mistakes

### HIGH Importing XlsOutputStrategy from wrong package

Wrong:

```ts
import { Server, UserAndPassword, XlsOutputStrategy } from "squilo"; // Not in core
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";
```

Excel output is in the `@squilo/xls-output-strategy` extension package, not the core `squilo` package.

Source: packages/squilo/src/index.ts

### HIGH Not destructuring the tuple return

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Output returns [ExecutionError[], result] — errors are lost
const users = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

if (errors.length > 0) {
	console.error("Some databases failed:", errors);
}
```

`.Output()` always returns a tuple `[ExecutionError[], result]`. The first element contains per-database errors. The second element is the strategy-specific output (array, filename, void).

Source: packages/squilo/src/pipes/output/strategies/merge.ts

### MEDIUM includeErrors changes return type

Wrong:

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

// includeErrors=true changes return type to string only
const [errors, filename] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		return (await conn.query`SELECT * FROM Users`).recordset;
	})
	.Output(JsonOutputStrategy(false, true));

// Type error: destructuring a string
```

Correct:

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

// With includeErrors=true, return type is string (filename)
const filename = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		return (await conn.query`SELECT * FROM Users`).recordset;
	})
	.Output(JsonOutputStrategy(false, true));

console.log(`Results in ${filename}`);
```

With `includeErrors: true`, errors are embedded in the output file and the return type changes from `[ExecutionError[], result]` to just `result` (e.g., `string` for JsonOutputStrategy, `string` for XlsOutputStrategy).

Source: packages/squilo/src/pipes/output/strategies/json.ts

### MEDIUM Assuming all output strategies are in core package

Wrong:

```bash
bun add squilo
# Tries to use XlsOutputStrategy — module not found
```

Correct:

```bash
bun add squilo @squilo/xls-output-strategy
```

Built-in strategies (`MergeOutputStrategy`, `JsonOutputStrategy`, `ConsoleOutputStrategy`) are in the core package. Excel output requires the `@squilo/xls-output-strategy` extension.

Source: packages/xls-output-strategy/package.json
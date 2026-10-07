---
name: handle-errors
description: >
  Handle errors across multi-database Squilo operations. Understand SAFE_GUARD
  env var (default=1, NaN disables), ExecutionError[] tuple returns,
  SAFE_GUARD halting behavior. Per-database errors returned not thrown (a
  failing discovery query rejects). Check array length after every operation. Mssql-specific error fields: code, number,
  state, class, serverName, procName, lineNumber.
type: core
library: squilo
library_version: "0.7.0-beta.3"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/runner/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/runner/types.ts"
  - "dodevs/Squilo:packages/squilo/src/utils/load-env.ts"
  - "dodevs/Squilo:packages/squilo/test/error-handling.spec.ts"
---

# Squilo — Handle Errors

Squilo collects errors per database rather than throwing. Errors are returned in tuples or arrays. The `SAFE_GUARD` environment variable controls when multi-database operations halt further connections.

## Setup

Capture errors from both `Execute()` and `Retrieve().Output()`:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Execute returns ExecutionError[] directly
const execErrors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET LastLogin = GETDATE()`;
	});

if (execErrors.length > 0) {
	console.error("Execute failures:", execErrors);
}

// Retrieve().Output() returns [ExecutionError[], result] tuple
const [retErrors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

if (retErrors.length > 0) {
	console.error("Retrieve failures:", retErrors);
}

console.log(`Found ${users.length} users`);
```

## Core Patterns

### Inspect mssql-specific error fields

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM MissingTable`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

for (const err of errors) {
	console.log(`Database: ${err.database}`);
	console.log(`Error: ${err.error.name}`);
	console.log(`Message: ${err.error.message}`);

	// Mssql-specific fields
	const mssql = err.error as import("mssql").RequestError;
	if (mssql.code) console.log(`Code: ${mssql.code}`);
	if (mssql.number) console.log(`Number: ${mssql.number}`);
	if (mssql.state) console.log(`State: ${mssql.state}`);
	if (mssql.class) console.log(`Class: ${mssql.class}`);
	if (mssql.serverName) console.log(`Server: ${mssql.serverName}`);
	if (mssql.procName) console.log(`Procedure: ${mssql.procName}`);
	if (mssql.lineNumber) console.log(`Line: ${mssql.lineNumber}`);
}
```

### Configure SAFE_GUARD to allow more errors before halting

```bash
# Allow up to 10 database errors before halting further connections
SAFE_GUARD=10 bun run script.ts

# Disable SAFE_GUARD entirely (process all databases regardless of errors)
SAFE_GUARD=0 bun run script.ts
```

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Script runs with process.env.SAFE_GUARD = "10" or "0"
const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3", "DB4", "DB5"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// errors contains failures from databases that were attempted
// If SAFE_GUARD triggered, some databases may not have been attempted
console.log(`${errors.length} databases failed`);
```

### Process partial results when some databases fail

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["WorkingDB", "BrokenDB"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// MergeOutputStrategy flattens data from successful databases
// errors contains failures from broken databases
console.log(`Users from ${2 - errors.length} databases:`, users);
```

## Common Mistakes

### CRITICAL Expecting errors to be thrown — they are returned

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

try {
	const [errors, users] = await Server({
		server: "localhost",
		port: 1433,
		options: { encrypt: false }
	}).Auth(UserAndPassword("sa", "password"))
		.Connect("MissingDB")
		.Retrieve(async (conn) => {
			const result = await conn.query`SELECT * FROM Users`;
			return result.recordset;
		})
		.Output(MergeOutputStrategy());
} catch (error) {
	// This catch block never triggers — errors are returned, not thrown
	console.error("Caught:", error);
}
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MissingDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

if (errors.length > 0) {
	console.error("Database failures:", errors);
}
```

The runner catches errors per database and collects them in `ExecutionError[]`; they are never thrown to the caller. Exception: when `.Connect({ database, query })` is used and the discovery query itself fails, `.Execute()` / `.Output()` reject with that error (wrap discovery runs in `try`/`catch`).

Source: packages/squilo/src/pipes/shared/runner/index.ts

### CRITICAL SAFE_GUARD=0 disables error halting, not error collection

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Setting SAFE_GUARD=0 means "process all databases no matter what"
// But the code still checks errors.length — confusion about what 0 means
process.env.SAFE_GUARD = "0";
const [errors] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM MissingTable`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// errors still contains failures — SAFE_GUARD=0 doesn't suppress errors
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// SAFE_GUARD=0 means: never stop processing, even if all databases fail
// Errors are still collected and returned — check the array
process.env.SAFE_GUARD = "0";
const [errors] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM MissingTable`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// errors.length === 2 (all databases failed, but all were attempted)
if (errors.length > 0) {
	console.error(`${errors.length} databases failed:`, errors);
}
```

`SAFE_GUARD=0` disables the halting mechanism — all databases are processed regardless of error count. Errors are still collected and returned.

Source: packages/squilo/src/pipes/shared/runner/index.ts

### HIGH Invalid SAFE_GUARD value silently disables guard

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// String values like "invalid" parse to NaN via Number.parseInt()
// NaN > 0 is false, so the guard never activates — all databases processed
process.env.SAFE_GUARD = "invalid";
const [errors] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM MissingTable`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Use numeric string values only: "0", "1", "5", "10"
process.env.SAFE_GUARD = "5"; // Halt after 5 errors
// Or omit entirely for default of 1
// process.env.SAFE_GUARD is undefined → defaults to 1

const [errors] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM MissingTable`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

`LoadEnv()` uses `Number.parseInt(Bun.env.SAFE_GUARD || '1', 10)`. Invalid strings parse to `NaN`. `NaN > 0` is `false`, so the guard never triggers. Only use numeric strings.

Source: packages/squilo/src/utils/load-env.ts

### HIGH Expecting errors.length to never exceed SAFE_GUARD

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Assuming SAFE_GUARD=1 means "at most 1 error, ever"
process.env.SAFE_GUARD = "1";
const [errors] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2", "DB3", "DB4"], 3) // concurrent=3
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Orders`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// DB1 runs alone first (warm-up) and succeeds.
// DB2, DB3 and DB4 then run at the same time. If all three fail,
// errors.length === 3: the guard only stops databases that have not started yet.
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// The first min(SAFE_GUARD, concurrent) databases run one at a time, so a
// systematic failure (missing table, bad login) halts the run before fanning out.
// After SAFE_GUARD errors, databases that have not started are skipped (no result
// is emitted for them). Executions already running are not cancelled.
// For strict "stop on first error" across the whole run, use concurrent=1.
process.env.SAFE_GUARD = "1";
const [errors] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2", "DB3", "DB4"], 1) // process one at a time
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Orders`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// With concurrent=1: the first failure trips the guard and the remaining databases never start
```

`SAFE_GUARD` halts databases that have not started but does not cancel in-flight executions (an `AbortSignal` passed in `.Connect(dbs, { signal })` does). Timeouts and aborts surface as errors named `TimeoutError` / `AbortError`; a callback that returns with a transaction still open (no `await using`) fails with `UnfinishedWorkError` and is rolled back; transient errors can be retried with `.Connect(dbs, { retry })` (see connect-to-databases). Concurrency is a sliding window: a new database starts as soon as any running one finishes.

Source: packages/squilo/src/pipes/shared/runner/index.ts

### MEDIUM Not checking errors array length after Execute

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

// Execute returns errors but code ignores them
await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

// No error check — silently ignores failures
console.log("Done");
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

if (errors.length > 0) {
	console.error(`${errors.length} databases failed:`, errors);
	process.exit(1);
}

console.log("All databases updated");
```

`Execute()` returns `Promise<ExecutionError[]>`. Always check the array length — errors are not thrown.

Source: packages/squilo/src/pipes/execute/index.ts

### MEDIUM Looking for external error log files

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// Agent looks for an "errors.json" or "errors.log" file that was never created
const errorFile = Bun.file("./errors.json");
if (await errorFile.exists()) { /* ... */ }
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

// Errors are in the tuple, not in external files
if (errors.length > 0) {
	console.error("Errors:", errors);
}
```

Errors are returned in the `[ExecutionError[], result]` tuple or from `Execute()` directly. No external error files are created by Squilo.

Source: packages/squilo/src/pipes/output/strategies/merge.ts
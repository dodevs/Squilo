---
name: execute-updates
description: >
  Run UPDATE, INSERT, DELETE, DDL across one or more databases with Execute().
  Returns Promise<ExecutionError[]> directly — no Output() chaining available.
  Per-database errors are collected not thrown (only a failing discovery query
  rejects). SAFE_GUARD limits errors before halting further connections. Always
  check the returned error array length.
type: core
library: squilo
library_version: "0.7.0-beta.3"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/execute/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/runner/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/runner/types.ts"
  - "dodevs/Squilo:packages/squilo/src/utils/load-env.ts"
---

# Squilo — Execute Updates

Run data modification operations (UPDATE, INSERT, DELETE, DDL) across one or more databases. `.Execute()` returns `Promise<ExecutionError[]>` directly.

## Setup

Simple update across a single database:

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDatabase")
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET LastLogin = GETDATE() WHERE Active = 1`;
	});

if (errors.length > 0) {
	console.error("Some databases failed:", errors);
}
```

## Core Patterns

### Update across multiple tenant databases

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["TenantDB1", "TenantDB2", "TenantDB3"], 2)
	.Execute(async (conn) => {
		// conn is already connected to the current database: no database prefix needed
		await conn.query`
			UPDATE dbo.Users SET Status = 'archived' WHERE LastLogin < DATEADD(year, -1, GETDATE())
		`;
	});

console.log(`${errors.length} databases failed out of 3`);
```

### Execute with transaction for atomic updates

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDatabase")
	.Execute(async (conn) => {
		await using tx = await conn.transaction$();

		// Run queries on the transaction: conn.query would use another pooled connection, outside it
		await tx.request().query`UPDATE Accounts SET Balance = Balance - 100 WHERE Id = 1`;
		await tx.request().query`UPDATE Accounts SET Balance = Balance + 100 WHERE Id = 2`;

		await tx.commit$();
	});
```

`tx` rolls back on dispose unless `commit$()` succeeded; if `commit$()` itself fails, the transaction is rolled back. A deadlock victim (error 1205) is already rolled back by SQL Server, so the original error surfaces as-is.

### Batch DDL across discovered databases

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT DatabaseName AS [Database] FROM ActiveClients`
	})
	.Execute(async (conn) => {
		await conn.query`
			ALTER TABLE dbo.Users ADD EmailVerified BIT DEFAULT 0
		`;
	});
```

## Common Mistakes

### HIGH Trying to chain .Output() after Execute

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Execute returns Promise<ExecutionError[]>, not a chain with .Output()
await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	})
	.Output(MergeOutputStrategy()); // TypeError: Execute(...).Output is not a function
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

if (errors.length > 0) {
	console.error("Failed databases:", errors);
}
```

`.Execute()` returns `Promise<ExecutionError[]>` directly. Only `.Retrieve()` returns a chain with `.Transform()` and `.Output()`.

Source: packages/squilo/src/pipes/execute/index.ts

### HIGH Not checking the returned ExecutionError[] array

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

// Errors silently ignored
await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

console.log("Update complete"); // May have failed on all 3 DBs
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

if (errors.length > 0) {
	console.error(`${errors.length} databases failed:`, errors);
	process.exit(1);
}

console.log("Update complete on all databases");
```

`.Execute()` collects errors per-database and returns them — it does not throw for them. Always check the returned array length. Exception: if a discovery query (`.Connect({ database, query })`) fails, `.Execute()` rejects with that error.

Source: packages/squilo/src/pipes/execute/index.ts

### MEDIUM Assuming Execute throws on first error

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

try {
	await Server({...})
		.Auth(UserAndPassword("sa", "password"))
		.Connect(["DB1", "DB2", "DB3"])
		.Execute(async (conn) => {
			await conn.query`UPDATE NonExistentTable SET X = 1`; // Throws on DB1?
		});
	console.log("Success");
} catch (e) {
	console.error("Failed:", e); // Catches nothing — errors are returned, not thrown
}
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Execute(async (conn) => {
		await conn.query`UPDATE NonExistentTable SET X = 1`;
	});

// Check which databases failed
errors.forEach(err => {
	console.error(`Database ${err.database} failed:`, err.error.message);
});
```

Individual database errors are caught by the runner and added to the returned `ExecutionError[]` array. The `Execute()` promise resolves with the error array — it never rejects for individual database failures (only a failing discovery query makes it reject).

Source: packages/squilo/src/pipes/shared/runner/index.ts

### MEDIUM SAFE_GUARD halting too early

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

// Default SAFE_GUARD=1 stops after first error, only 1 DB processed
const errors = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3", "DB4", "DB5"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

// errors.length === 1, only DB1 was attempted
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

// Allow more errors before halting, or disable entirely
process.env.SAFE_GUARD = "0"; // Process all databases regardless of errors

const errors = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3", "DB4", "DB5"])
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

// All 5 databases processed, errors contains all failures
```

`SAFE_GUARD` defaults to `1`. After N errors, further database connections are halted. Set `SAFE_GUARD=0` to process all databases regardless of errors. Executions already running finish and are reported; databases that have not started are skipped.

Source: packages/squilo/src/utils/load-env.ts
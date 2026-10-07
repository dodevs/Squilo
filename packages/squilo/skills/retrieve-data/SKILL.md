---
name: retrieve-data
description: >
  Query data across multiple SQL Server databases with Retrieve(). Streaming
  results via ReadableStream. ConnectionPoolWrapper with AsyncDisposable
  auto-closes connections. Transaction support with commit$() for atomicity.
  Must end chain with Output() or Transform().Output() to consume stream.
type: core
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/retrieve/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/retrieve/types.ts"
  - "dodevs/Squilo:packages/squilo/src/pool/index.ts"
---

# Squilo — Retrieve Data

Query data from one or more databases with `.Retrieve()`. Returns a `RetrieveChain` with `.Transform()` and `.Output()` methods. The stream must be consumed.

## Setup

Basic query across multiple databases:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`
			SELECT * FROM Users WHERE Database = ${db}
		`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

console.log(`Found ${users.length} users`);
process.exit(0);
```

## Core Patterns

### Transaction with automatic rollback

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("AnalyticsDB")
	.Retrieve(async (conn) => {
		await using transaction = await conn.transaction$();

		await conn.query`
			UPDATE Accounts SET Balance = Balance - 100 WHERE Id = 1
		`;
		await conn.query`
			UPDATE Accounts SET Balance = Balance + 100 WHERE Id = 2
		`;

		await transaction.commit$();
		return { transferred: true };
	})
	.Output(MergeOutputStrategy());
```

`await using` automatically disposes the transaction. If `commit$()` is not called, it rolls back.

### Query with Table-Valued Parameter

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";
import { SQL } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("OrdersDB")
	.Retrieve(async (conn) => {
		const table = new SQL.Table();
		table.create = false;
		table.columns.add("ProductId", SQL.Int, { nullable: false });
		table.rows.add(101);
		table.rows.add(102);
		table.rows.add(103);

		const request = new SQL.Request(conn);
		request.input("Products", table);

		const result = await request.query`
			SELECT * FROM Orders WHERE ProductId IN (SELECT ProductId FROM @Products)
		`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

### Multi-database discovery and retrieve

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, clients] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT Database, ClientName, Region FROM ActiveClients`
	})
	.Retrieve(async (conn, db) => {
		const result = await conn.query`
			SELECT ${db.ClientName} AS Client, * FROM ${db.Database}.dbo.Users
		`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

## Common Mistakes

### CRITICAL Stream not consumed — script hangs

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

// Retrieve returns a ReadableStream. Without Output(), the stream
// is never consumed and the script hangs indefinitely.
await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	});
// Script hangs here — no error, no output
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

console.log(users);
process.exit(0);
```

`.Retrieve()` returns a lazy `ReadableStream` of results: nothing runs until `.Output()` (or `.Transform().Output()`) consumes it.

Source: packages/squilo/src/pipes/retrieve/index.ts

### HIGH Forgetting await using on ConnectionPoolWrapper

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		// Manual connection management — pool leaks on error
		const result = await conn.query`SELECT * FROM Users`;
		await conn.close(); // May not run if query throws
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		await using wrapped = conn; // Auto-disposes via AsyncDisposable
		const result = await wrapped.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

`ConnectionPoolWrapper` implements `AsyncDisposable`. `await using` auto-closes the connection when the scope exits, even on error. Manual `.close()` is unnecessary and error-prone.

Source: packages/squilo/src/pool/index.ts

### HIGH Forgetting commit$() causes silent rollback

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		await using tx = await conn.transaction$();
		await conn.query`UPDATE Accounts SET Balance = 0`;
		// Missing tx.commit$() — transaction auto-rolls back
		return { updated: true };
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		await using tx = await conn.transaction$();
		await conn.query`UPDATE Accounts SET Balance = 0`;
		await tx.commit$(); // Must call before scope exits
		return { updated: true };
	})
	.Output(MergeOutputStrategy());
```

`TransactionWrapper` auto-rolls back on disposal if `commit$()` was not called. The update is silently undone — no error is thrown.

Source: packages/squilo/src/pool/index.ts

### MEDIUM Putting expensive post-processing inside Retrieve

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM Orders`;

		// Expensive file I/O blocks the connection
		const file = await Bun.file(`./temp-${db}.json`).text();
		const enriched = result.recordset.map(row => ({ ...row, metadata: JSON.parse(file) }));

		return enriched;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM Orders`;
		return result.recordset; // Just return raw data
	})
	.Transform(async (orders) => {
		// File I/O happens AFTER connections are closed
		const file = await Bun.file("./metadata.json").text();
		return orders.map(row => ({ ...row, metadata: JSON.parse(file) }));
	})
	.Output(MergeOutputStrategy());
```

`Retrieve` should return raw query results. Move expensive operations (file I/O, API calls, heavy computation) to `.Transform()`. Each database's connection is released before its result reaches `.Transform()`.

Source: packages/squilo/src/pipes/retrieve/index.ts

### MEDIUM Using .Output() on Execute instead of Retrieve

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Execute returns Promise<ExecutionError[]>, not a chain with .Output()
await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	})
	.Output(MergeOutputStrategy()); // TypeError: Execute(...).Output is not a function
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Execute(async (conn) => {
		await conn.query`UPDATE Users SET Active = 1`;
	});

if (errors.length > 0) {
	console.error("Some databases failed:", errors);
}
```

`.Execute()` returns `Promise<ExecutionError[]>` directly. Only `.Retrieve()` returns a chain with `.Transform()` and `.Output()`.

Source: packages/squilo/src/pipes/execute/index.ts
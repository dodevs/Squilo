---
name: connect-to-databases
description: >
  Connect to single database, array of databases with concurrency limit, or
  dynamically discover databases via query with Database column. Returns
  ConnectionChain with Execute() and Retrieve(). DatabaseObject carries extra
  properties from discovery query. ExecutionOptions add retry (transient errors),
  per-database timeout and AbortSignal cancellation.
type: core
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/connect/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/connect/types.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/runner/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/runner/transient.ts"
---

# Squilo — Connect to Databases

Specify which database(s) to connect to after authentication is configured. `.Connect()` returns a `ConnectionChain` with `.Execute()` and `.Retrieve()`.

## Setup

Connect to a single database:

```ts
import { Server, UserAndPassword } from "squilo";

const connection = Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDatabase");
```

## Core Patterns

### Connect to multiple databases with concurrency limit

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, allUsers] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["TenantDB1", "TenantDB2", "TenantDB3", "TenantDB4", "TenantDB5"], 2)
	.Retrieve(async (conn, db) => {
		// conn is already connected to `db`: no database prefix needed
		const result = await conn.query`SELECT * FROM dbo.Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

`2` = max 2 concurrent connections. Remaining databases wait in a sliding window: each one starts as soon as any running database finishes.

### Retry, timeout and cancellation

```ts
import { Server, UserAndPassword, IsTransientError } from "squilo";

const controller = new AbortController();
process.on("SIGINT", () => controller.abort());

const errors = await Server({ ... }).Auth(UserAndPassword("sa", "password"))
	.Connect(["TenantDB1", "TenantDB2", "TenantDB3"], {
		concurrent: 2,
		retry: { times: 3, delay: "500 millis", while: IsTransientError }, // or just `retry: 3`
		timeout: "2 minutes",
		signal: controller.signal,
	})
	.Execute(async (conn) => {
		await using tx = await conn.transaction$();
		await tx.request().query`UPDATE Users SET Active = 1`;
		await tx.commit$();
	});
```

- `retry` re-runs the whole callback on a fresh connection (exponential backoff). Default predicate `IsTransientError`: deadlock (1205), lock timeout, Azure SQL throttling/failover, dropped connections. Only SAFE_GUARD-counted once retries are exhausted.
- `timeout` is per database, retries included. The database fails with `error.name === "TimeoutError"`.
- `signal`: databases not started are skipped (no result); in-flight ones fail with `error.name === "AbortError"`.
- On timeout/abort the connection is closed at the socket level: the query stops and SQL Server rolls back the open transaction.

### Dynamic database discovery via query

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, clients] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect<{ Database: string; ClientName: string; Region: string; PlanType: string }>({
		database: "ClientsManager",
		query: `SELECT DatabaseName AS [Database], ClientName, Region, PlanType FROM ActiveClients WHERE Active = 1`
	})
	.Retrieve(async (conn, db) => {
		// conn is connected to db.Database; ${...} values become bound parameters, not SQL text
		const result = await conn.query`SELECT * FROM dbo.Users WHERE PlanType = ${db.PlanType}`;
		return result.recordset.map((user) => ({ ...user, Client: db.ClientName, Region: db.Region }));
	})
	.Output(MergeOutputStrategy());
```

The query must return rows with a `Database` column (the `query` type requires `[Database]` between `SELECT` and `FROM`). Additional columns become properties on the database object passed to the callback; pass their type explicitly (`.Connect<{ Database: string; ... }>(...)`), otherwise `db` is only `DatabaseObject` (`{ Database: string }`).

The discovery connection is closed after the query. If the discovery query itself fails, there are no databases to run: `.Execute()` / `.Output()` reject with that error instead of returning it as data.

### Using discovered database properties in Execute

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect<{ Database: string; LastSyncDate: Date }>({
		database: "ClientsManager",
		query: `SELECT DatabaseName AS [Database], LastSyncDate FROM Clients WHERE NeedsSync = 1`
	})
	.Execute(async (conn, db) => {
		await conn.query`
			UPDATE SyncLog SET LastRun = GETDATE()
			WHERE ClientDb = ${db.Database} AND LastRun < ${db.LastSyncDate}
		`;
	});
```

## Common Mistakes

### HIGH Discovery query missing Database column

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

Server({...}).Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT ClientName, Region FROM ActiveClients` // Missing Database column
	});
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

Server({...}).Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT DatabaseName AS [Database], ClientName, Region FROM ActiveClients`
	});
```

The discovery query must return a `Database` column. This column is used to connect to each discovered database. `DATABASE` is a reserved word in T-SQL, so alias it with brackets (`... AS [Database]`); the `ConnectionOptions.query` type (`SELECT ${string}[Database]${string} FROM ${string}`) rejects queries without it at compile time.

Source: packages/squilo/src/pipes/connect/types.ts

### MEDIUM Forgetting concurrency limit for many databases

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

// 50 databases, no concurrency limit — opens 50 simultaneous connections
Server({...}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", ..., "DB50"])
	.Execute(async (conn) => { ... });
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

// Limit to 5 concurrent connections
Server({...}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", ..., "DB50"], 5)
	.Execute(async (conn) => { ... });
```

Without a concurrency limit, all databases connect simultaneously. This can overwhelm the SQL Server or exhaust connection pool limits. Always set a concurrency limit for multi-database operations.

Source: packages/squilo/src/pipes/connect/index.ts

### MEDIUM Expecting Connect to return a direct connection

Wrong:

```ts
import { Server, UserAndPassword } from "squilo";

const conn = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB"); // Returns ConnectionChain, not ConnectionPool

await conn.query`SELECT * FROM Users`; // TypeError: conn.query is not a function
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

`.Connect()` returns a `ConnectionChain` with `.Execute()` and `.Retrieve()` — not a direct connection. The actual `ConnectionPool` is passed to the callback function.

Source: packages/squilo/src/pipes/connect/types.ts
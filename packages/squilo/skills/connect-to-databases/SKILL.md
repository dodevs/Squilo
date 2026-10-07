---
name: connect-to-databases
description: >
  Connect to single database, array of databases with concurrency limit, or
  dynamically discover databases via query with Database column. Returns
  ConnectionChain with Execute() and Retrieve(). DatabaseObject carries extra
  properties from discovery query.
type: core
library: squilo
library_version: "0.7.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/connect/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/connect/types.ts"
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
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

`2` = max 2 concurrent connections. Remaining databases wait in a sliding window: each one starts as soon as any running database finishes.

### Dynamic database discovery via query

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, clients] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT Database, ClientName, Region, PlanType FROM ActiveClients WHERE Active = 1`
	})
	.Retrieve(async (conn, db) => {
		// db has type DatabaseObject = { Database: string, ClientName: string, Region: string, PlanType: string }
		const result = await conn.query`
			SELECT '${db.ClientName}' AS Client, '${db.Region}' AS Region, *
			FROM ${db.Database}.dbo.Users
			WHERE PlanType = ${db.PlanType}
		`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());
```

The query must return rows with a `Database` column. Additional columns become properties on the `DatabaseObject` and are available in the `.Retrieve()` callback.

### Using discovered database properties in Execute

```ts
import { Server, UserAndPassword } from "squilo";

const errors = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT Database, LastSyncDate FROM Clients WHERE NeedsSync = 1`
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
		query: `SELECT Database, ClientName, Region FROM ActiveClients`
	});
```

The discovery query must return a `Database` column. This column is used to connect to each discovered database. Without it, the connection mechanism has no database names to connect to.

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
---
name: transform-data
description: >
  Insert expensive post-processing after Retrieve() via Transform() TransformStream.
  Runs once per database result (completion order), after that database's
  connection is released. Use for file I/O, API calls, heavy computation. Not for simple mapping — inline that in Retrieve callback.
  Returns TransformChain with .Output().
type: core
library: squilo
library_version: "0.7.0-beta.3"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/transform/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/transform/types.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/retrieve/index.ts"
---

# Squilo — Transform Data

Move expensive post-processing out of database callbacks and into `.Transform()`. The transform function runs once per successful database result, in completion order, with that database's data only: each database's connection is released before its result is emitted, while other databases may still be running. Errored results bypass it.

## Setup

Basic transformation after retrieving data:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, enriched] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("MyDatabase")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT Id, Name, Email FROM Users`;
		return result.recordset; // Just return raw data
	})
	.Transform(async (users) => {
		// Runs after this database's connection is released
		return users.map(u => ({ ...u, domain: u.Email.split("@")[1] }));
	})
	.Output(MergeOutputStrategy());
```

## Core Patterns

### File I/O after connection release

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, enriched] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Orders`;
		return result.recordset;
	})
	.Transform(async (orders) => {
		// Runs once per database, after that database's connection is released
		const config = await Bun.file("./pricing-config.json").json();
		return orders.map(o => ({
			...o,
			price: o.Quantity * config[o.ProductId]
		}));
	})
	.Output(MergeOutputStrategy());
```

### External API call enrichment

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect("CRMDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT CustomerId, Name FROM Customers`;
		return result.recordset;
	})
	.Transform(async (customers) => {
		// API call happens after the database connection is released
		const enriched = await Promise.all(
			customers.map(async c => {
				const res = await fetch(`https://api.example.com/customers/${c.CustomerId}`);
				const data = await res.json();
				return { ...c, creditScore: data.score };
			})
		);
		return enriched;
	})
	.Output(MergeOutputStrategy());
```

### When NOT to use Transform — simple inline mapping

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Simple mapping — do this inline in Retrieve, not in Transform
const [errors, users] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT Id, Name FROM Users`;
		// Simple transformation — inline is fine
		return result.recordset.map(u => ({ ...u, displayName: u.Name.toUpperCase() }));
	})
	.Output(MergeOutputStrategy());
```

## Common Mistakes

### CRITICAL Putting expensive operations inside Retrieve

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM Orders`;

		// File I/O blocks the database connection
		const file = await Bun.file(`./config-${db}.json`).text();
		const config = JSON.parse(file);

		return result.recordset.map(o => ({
			...o,
			price: o.Quantity * config[o.ProductId]
		}));
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Orders`;
		return result.recordset; // Return raw data
	})
	.Transform(async (orders) => {
		// Runs per database, after that database's connection is released
		const file = await Bun.file("./pricing-config.json").text();
		const config = JSON.parse(file);
		return orders.map(o => ({
			...o,
			price: o.Quantity * config[o.ProductId]
		}));
	})
	.Output(MergeOutputStrategy());
```

`Retrieve` callbacks hold database connections open. Expensive operations (file I/O, API calls, heavy computation) block the connection pool. Move them to `.Transform()` — it runs on each database's result after that database's connection is released.

Source: packages/squilo/src/pipes/retrieve/index.ts

### MEDIUM Using Transform for simple array mapping

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT Id, Name FROM Users`;
		return result.recordset;
	})
	.Transform(async (users) => {
		// Unnecessary TransformStream overhead for simple mapping
		return users.map(u => ({ ...u, displayName: u.Name.toUpperCase() }));
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
		const result = await conn.query`SELECT Id, Name FROM Users`;
		// Simple transformation — inline in Retrieve
		return result.recordset.map(u => ({ ...u, displayName: u.Name.toUpperCase() }));
	})
	.Output(MergeOutputStrategy());
```

`Transform()` creates a `TransformStream` with async machinery. For simple synchronous mapping, inlining in `.Retrieve()` is more efficient. Reserve `.Transform()` for expensive async operations.

Source: packages/squilo/src/pipes/transform/index.ts

### MEDIUM Expecting Transform to see all databases at once

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM dbo.Logs`;
		return result.recordset;
	})
	.Transform(async (logs) => {
		// logs holds ONE database's rows, and the database name is not passed in
		const perDb = groupBy(logs, "database"); // No such field; never sees DB2/DB3 rows together
		return perDb;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, logs] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM dbo.Logs`;
		// Attach database context before returning
		return result.recordset.map(row => ({ ...row, _database: db }));
	})
	.Output(MergeOutputStrategy());

// Group across databases after the results are merged
const perDb = Object.groupBy(logs, (log) => log._database);
```

`.Transform()` is called once per database with only the data that database's `.Retrieve()` callback returned — no connection, no database name, no other databases' rows. Attach per-database context in `.Retrieve()`, and aggregate across databases after a merging output (or in a custom output strategy).

Source: packages/squilo/src/pipes/transform/index.ts
---
name: transform-data
description: >
  Insert expensive post-processing after Retrieve() via Transform() TransformStream.
  Database connections close before Transform runs. Use for file I/O, API calls,
  heavy computation. Not for simple mapping — inline that in Retrieve callback.
  Returns TransformChain with .Output().
type: core
library: squilo
library_version: "0.7.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/transform/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/transform/types.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/retrieve/index.ts"
---

# Squilo — Transform Data

Move expensive post-processing out of database callbacks and into `.Transform()`. Database connections close before the `TransformStream` runs.

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
		// Runs after all database connections are closed
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
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM Orders`;
		return result.recordset;
	})
	.Transform(async (orders) => {
		// File read happens AFTER all DB connections close
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
		// API call happens after DB connections released
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
		// File I/O happens AFTER all connections close
		const file = await Bun.file("./pricing-config.json").text();
		const config = JSON.parse(file);
		return orders.map(o => ({
			...o,
			price: o.Quantity * config[o.ProductId]
		}));
	})
	.Output(MergeOutputStrategy());
```

`Retrieve` callbacks hold database connections open. Expensive operations (file I/O, API calls, heavy computation) block the connection pool. Move them to `.Transform()` — the `TransformStream` runs after all connections are released.

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

### MEDIUM Not understanding that Transform runs after ALL connections close

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Logs`;
		return result.recordset;
	})
	.Transform(async (logs) => {
		// Trying to use database name here — it's not available in Transform
		// logs is just the merged data, no database context
		const perDb = groupBy(logs, "database"); // Can't do this — database info lost
		return perDb;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, result] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Logs`;
		// Attach database context before returning
		return result.recordset.map(row => ({ ...row, _database: db }));
	})
	.Transform(async (logs) => {
		// Now database context is available in the data
		const perDb = groupBy(logs, "_database");
		return perDb;
	})
	.Output(MergeOutputStrategy());
```

`.Transform()` receives only the data returned from `.Retrieve()` — no database connection or metadata. If you need per-database context, attach it to the data in `.Retrieve()` before returning.

Source: packages/squilo/src/pipes/transform/index.ts
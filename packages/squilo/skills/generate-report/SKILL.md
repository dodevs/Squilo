---
name: generate-report
description: >
  End-to-end report workflow: discover tenant databases from management DB,
  retrieve usage/cost data per DB, transform/aggregate, output to Excel with
  XlsOutputStrategy(combineSheets) or JSON with JsonOutputStrategy. Handle
  partial failures with SAFE_GUARD awareness.
type: lifecycle
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/README.md"
  - "dodevs/Squilo:packages/squilo/src/pipes/connect/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/retrieve/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/transform/index.ts"
  - "dodevs/Squilo:packages/xls-output-strategy/src/xls.ts"
---

# Squilo — Generate Report

End-to-end workflow for generating reports across multiple tenant databases. Covers discovery, retrieval, transformation, and output to Excel or JSON.

## Setup

```bash
bun add squilo @squilo/xls-output-strategy
```

## Core Patterns

### Discover tenants and generate Excel report

```ts
import { Server, UserAndPassword } from "squilo";
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";

const [errors, filename] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect<{ Database: string; ClientName: string; Region: string }>({
		database: "ClientsManager",
		query: `SELECT DatabaseName AS [Database], ClientName, Region FROM ActiveClients WHERE Active = 1`
	})
	.Retrieve(async (conn, db) => {
		// conn is connected to db.Database; add per-client columns in JS, not by interpolating SQL text
		const result = await conn.query`
			SELECT
				ProductId,
				SUM(Quantity) AS TotalQuantity,
				SUM(TotalCost) AS TotalCost
			FROM dbo.Orders
			WHERE CreatedAt >= DATEADD(month, -1, GETDATE())
			GROUP BY ProductId
		`;
		return result.recordset.map((row) => ({ Client: db.ClientName, Region: db.Region, ...row }));
	})
	.Output(XlsOutputStrategy(true, true, false));
// combineSheets=true, includeEmpty=true, includeErrors=false

console.log(`Report generated: ${filename}`);
process.exitCode = errors.length > 0 ? 1 : 0;
```

### Aggregate per database with Transform, then across databases

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

type Order = { ProductId: string; Quantity: number; TotalCost: number };
type ProductTotals = { productId: string; quantity: number; cost: number };

const sumByProduct = (rows: ProductTotals[]): ProductTotals[] => {
	const byProduct = new Map<string, ProductTotals>();
	for (const row of rows) {
		const totals = byProduct.get(row.productId) ?? { productId: row.productId, quantity: 0, cost: 0 };
		totals.quantity += row.quantity;
		totals.cost += row.cost;
		byProduct.set(row.productId, totals);
	}
	return [...byProduct.values()];
};

const [errors, perDatabase] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT DatabaseName AS [Database] FROM ActiveClients`
	})
	.Retrieve(async (conn) => {
		const result = await conn.query<Order>`SELECT ProductId, Quantity, TotalCost FROM dbo.Orders`;
		return result.recordset;
	})
	// Runs once per database, with that database's orders only
	.Transform((orders) => sumByProduct(orders.map((o) => ({ productId: o.ProductId, quantity: o.Quantity, cost: o.TotalCost }))))
	.Output(MergeOutputStrategy());

// Across databases: aggregate the merged per-database totals after Output
const report = sumByProduct(perDatabase);
```

`.Transform()` never sees more than one database's data. To aggregate across databases, do it after a merging output (`MergeOutputStrategy`) or inside a custom output strategy.

### Scheduled report script with error handling

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

async function generateMonthlyReport() {
	process.env.SAFE_GUARD = "3"; // Allow up to 3 failures before halting

	const [errors, filename] = await Server({...})
		.Auth(UserAndPassword("sa", "password"))
		.Connect({
			database: "ClientsManager",
			// ClientName is written to the JSON with each result's `database` object
			query: `SELECT DatabaseName AS [Database], ClientName FROM ActiveClients`
		})
		.Retrieve(async (conn) => {
			const result = await conn.query`
				SELECT COUNT(*) AS UserCount,
					AVG(DATEDIFF(day, LastLogin, GETDATE())) AS AvgDaysInactive
				FROM dbo.Users
			`;
			return result.recordset[0];
		})
		.Output(JsonOutputStrategy(true, false)); // includeEmpty=true, includeErrors=false

	if (errors.length > 0) {
		console.error(`${errors.length} databases failed:`,
			errors.map(e => ({ db: e.database, error: e.error.message })));
	}

	console.log(`Report saved to ${filename}`);
	return { filename, errors: errors.length };
}

const report = await generateMonthlyReport();
process.exitCode = report.errors > 0 ? 1 : 0;
```

## Common Mistakes

### CRITICAL Not handling partial failures

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [, users] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3", "DB4", "DB5"])
	.Retrieve(async (conn) => {
		return (await conn.query`SELECT * FROM Users`).recordset;
	})
	.Output(MergeOutputStrategy());

// 2 databases failed silently — only 3 contributed to results
console.log(`Total users: ${users.length}`); // Under-reported
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3", "DB4", "DB5"])
	.Retrieve(async (conn) => {
		return (await conn.query`SELECT * FROM Users`).recordset;
	})
	.Output(MergeOutputStrategy());

if (errors.length > 0) {
	console.warn(`Report is PARTIAL — ${errors.length} databases failed:`);
	errors.forEach(e => console.warn(`  - ${e.database}: ${e.error.message}`));
}

console.log(`Users from ${5 - errors.length}/${5} databases: ${users.length}`);
process.exitCode = errors.length > 0 ? 1 : 0;
```

In multi-tenant reporting, some databases may be offline or have schema differences. Always check `errors.length` and report partial results explicitly. Use `SAFE_GUARD=0` to process all databases regardless of failures.

Source: packages/squilo/src/pipes/shared/runner/index.ts

### HIGH Aggregating data inside Retrieve instead of Transform

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, report] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM Orders`;
		// Aggregation keeps connections open longer
		const stats = {
			database: db,
			count: result.recordset.length,
			total: result.recordset.reduce((s, o) => s + o.Total, 0)
		};
		return stats;
	})
	.Output(MergeOutputStrategy());
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, report] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2", "DB3"])
	.Retrieve(async (conn) => {
		// Return raw data, close connection quickly
		return (await conn.query`SELECT * FROM Orders`).recordset;
	})
	.Transform(async (orders) => {
		// Runs per database, after that database's connection is released
		return {
			count: orders.length,
			total: orders.reduce((s, o) => s + o.Total, 0)
		};
	})
	.Output(MergeOutputStrategy());
```

Aggregation in `.Retrieve()` holds the database connection open during computation. Move it to `.Transform()`: each database's connection is released before its result is emitted, then `.Transform()` runs on that database's data (other databases may still be running). `.Transform()` does not receive the database name; the output strategy still gets it with each result.

Source: packages/squilo/src/pipes/retrieve/index.ts

### MEDIUM Wrong XlsOutputStrategy parameters for combined sheets

Wrong:

```ts
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";

// Want combined sheet, but passing wrong parameter order
const [errors, filename] = await Server({...})
	... // pipeline
	.Output(XlsOutputStrategy(false, false, true));
// Separate sheets, skip empty, include errors
```

Correct:

```ts
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";

// combineSheets=true, includeEmpty=true, includeErrors=false
const [errors, filename] = await Server({...})
	... // pipeline
	.Output(XlsOutputStrategy(true, true, false));
```

Parameter order: `XlsOutputStrategy(combineSheets?, includeEmpty?, includeErrors?)`. Default is `false, true, false` (separate sheets, include empty, don't include errors). Combined sheets adds a `database` column and row grouping.

Source: packages/xls-output-strategy/src/xls.ts
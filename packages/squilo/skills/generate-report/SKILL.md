---
name: generate-report
description: >
  End-to-end report workflow: discover tenant databases from management DB,
  retrieve usage/cost data per DB, transform/aggregate, output to Excel with
  XlsOutputStrategy(combineSheets) or JSON with JsonOutputStrategy. Handle
  partial failures with SAFE_GUARD awareness. Always process.exit() at end
  of standalone report scripts.
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
	.Connect({
		database: "ClientsManager",
		query: `SELECT Database, ClientName, Region FROM ActiveClients WHERE Active = 1`
	})
	.Retrieve(async (conn, db) => {
		const result = await conn.query`
			SELECT
				'${db.ClientName}' AS Client,
				'${db.Region}' AS Region,
				ProductId,
				SUM(Quantity) AS TotalQuantity,
				SUM(TotalCost) AS TotalCost
			FROM ${db.Database}.dbo.Orders
			WHERE CreatedAt >= DATEADD(month, -1, GETDATE())
			GROUP BY ProductId
		`;
		return result.recordset;
	})
	.Output(XlsOutputStrategy(true, true, false));
// combineSheets=true, includeEmpty=true, includeErrors=false

console.log(`Report generated: ${filename}`);
process.exit(errors.length > 0 ? 1 : 0);
```

### Aggregate with Transform before output

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

const [errors, filename] = await Server({...})
	.Auth(UserAndPassword("sa", "password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT Database, ClientName FROM ActiveClients`
	})
	.Retrieve(async (conn, db) => {
		const result = await conn.query`
			SELECT ProductId, Quantity, TotalCost
			FROM ${db.Database}.dbo.Orders
		`;
		return result.recordset;
	})
	.Transform(async (orders) => {
		// Aggregate across all databases
		const byProduct: Record<string, { quantity: number; cost: number }> = {};
		for (const o of orders) {
			if (!byProduct[o.ProductId]) {
				byProduct[o.ProductId] = { quantity: 0, cost: 0 };
			}
			byProduct[o.ProductId].quantity += o.Quantity;
			byProduct[o.ProductId].cost += o.TotalCost;
		}
		return Object.entries(byProduct).map(([id, stats]) => ({
			productId: id,
			...stats
		}));
	})
	.Output(JsonOutputStrategy());

console.log(`Aggregated report: ${filename}`);
process.exit(0);
```

### Scheduled report script with error handling

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

async function generateMonthlyReport() {
	process.env.SAFE_GUARD = "3"; // Allow up to 3 failures before halting

	const [errors, filename] = await Server({...})
		.Auth(UserAndPassword("sa", "password"))
		.Connect({
			database: "ClientsManager",
			query: `SELECT Database, ClientName FROM ActiveClients`
		})
		.Retrieve(async (conn, db) => {
			const result = await conn.query`
				SELECT COUNT(*) AS UserCount,
					AVG(DATEDIFF(day, LastLogin, GETDATE())) AS AvgDaysInactive
				FROM ${db.Database}.dbo.Users
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
process.exit(report.errors > 0 ? 1 : 0);
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
process.exit(errors.length > 0 ? 1 : 0);
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
		// Aggregate after all connections are closed
		return {
			count: orders.length,
			total: orders.reduce((s, o) => s + o.Total, 0)
		};
	})
	.Output(MergeOutputStrategy());
```

Aggregation in `.Retrieve()` holds database connections open during computation. Move aggregation to `.Transform()` — connections close first, then computation runs.

Source: packages/squilo/src/pipes/retrieve/index.ts

### MEDIUM Forgetting process.exit() in standalone report script

Wrong:

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

const [errors, filename] = await Server({...})
	... // pipeline
	.Output(JsonOutputStrategy());

console.log(`Report: ${filename}`);
// Script hangs — pools and progress bar keep event loop alive
```

Correct:

```ts
import { Server, UserAndPassword, JsonOutputStrategy } from "squilo";

const [errors, filename] = await Server({...})
	... // pipeline
	.Output(JsonOutputStrategy());

console.log(`Report: ${filename}`);
process.exit(errors.length > 0 ? 1 : 0);
```

Report scripts are standalone processes. Connection pools and the `cli-progress` bar keep the event loop alive. Always call `process.exit()` at the end.

Source: packages/squilo/src/pipes/shared/runner/index.ts

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
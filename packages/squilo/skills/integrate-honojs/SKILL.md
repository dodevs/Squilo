---
name: integrate-honojs
description: >
  Wire Squilo streaming Retrieve/Output pipeline to HonoJS Response helpers.
  Build API routes serving SQL query results over HTTP. Accumulate results
  for JSON response or stream chunks for real-time output. Hono is external
  — skill focuses on the integration seam.
type: composition
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/README.md"
  - "dodevs/Squilo:packages/squilo/src/pipes/retrieve/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/merge.ts"
---

# Squilo — Integrate with HonoJS

Build HTTP API routes with Hono that serve Squilo query results. Hono is an external dependency — this skill covers the integration patterns.

## Setup

```bash
bun add squilo hono
```

## Core Patterns

### JSON API route with accumulated results

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const app = new Hono();

app.get("/api/users", async (c) => {
	const [errors, users] = await Server({
		server: process.env.DB_SERVER!,
		port: 1433,
		options: { encrypt: true }
	}).Auth(UserAndPassword(
		process.env.DB_USER!,
		process.env.DB_PASSWORD!
	))
		.Connect(["TenantDB1", "TenantDB2"])
		.Retrieve(async (conn) => {
			const result = await conn.query`SELECT * FROM dbo.Users`;
			return result.recordset;
		})
		.Output(MergeOutputStrategy());

	if (errors.length > 0) {
		return c.json({ error: "Partial failure", failed: errors.length, users }, 207);
	}

	return c.json({ count: users.length, users });
});

export default app;
```

### Streaming route for real-time results

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, ConsoleOutputStrategy } from "squilo";

const app = new Hono();

app.get("/api/stream-logs", async (c) => {
	const stream = new ReadableStream({
		start: async (controller) => {
			await Server({
				server: process.env.DB_SERVER!,
				port: 1433,
				options: { encrypt: true }
			}).Auth(UserAndPassword(
				process.env.DB_USER!,
				process.env.DB_PASSWORD!
			))
				.Connect(["LogDB1", "LogDB2"])
				.Retrieve(async (conn) => {
					const result = await conn.query`SELECT * FROM dbo.Logs`;
					return result.recordset;
				})
				.Output(async (result) => {
					for await (const chunk of result) {
						controller.enqueue(`data: ${JSON.stringify(chunk)}\n\n`);
					}
					controller.close();
				});
		}
	});

	return new Response(stream, {
		headers: {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache"
		}
	});
});
```

### Route with database parameter

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const app = new Hono();

app.get("/api/:tenant/users", async (c) => {
	const tenant = c.req.param("tenant");

	const [errors, users] = await Server({...})
		.Auth(UserAndPassword(process.env.DB_USER!, process.env.DB_PASSWORD!))
		.Connect(tenant)
		.Retrieve(async (conn) => {
			const result = await conn.query`SELECT * FROM Users`;
			return result.recordset;
		})
		.Output(MergeOutputStrategy());

	if (errors.length > 0) {
		return c.json({ error: "Database query failed" }, 500);
	}

	return c.json({ tenant, count: users.length, users });
});
```

## Common Mistakes

### HIGH Not awaiting the Squilo pipeline before Hono response

Wrong:

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

app.get("/api/users", (c) => {
	// Not awaited — returns Promise, not Response
	const [errors, users] = Server({...})
		.Auth(UserAndPassword("sa", "password"))
		.Connect("MyDB")
		.Retrieve(async (conn) => {
			return (await conn.query`SELECT * FROM Users`).recordset;
		})
		.Output(MergeOutputStrategy());

	return c.json(users); // users is a Promise, not an array
});
```

Correct:

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

app.get("/api/users", async (c) => {
	const [errors, users] = await Server({...})
		.Auth(UserAndPassword("sa", "password"))
		.Connect("MyDB")
		.Retrieve(async (conn) => {
			return (await conn.query`SELECT * FROM Users`).recordset;
		})
		.Output(MergeOutputStrategy());

	return c.json({ count: users.length, users });
});
```

Hono route handlers that call async Squilo pipelines must be declared `async` and must `await` the pipeline before constructing the `Response`.

Source: packages/squilo/README.md

### MEDIUM Not handling errors in route response

Wrong:

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

app.get("/api/users", async (c) => {
	const [errors, users] = await Server({...})
		.Connect(["DB1", "DB2"])
		... // pipeline
		.Output(MergeOutputStrategy());

	// Errors silently ignored — returns 200 with partial data
	return c.json(users);
});
```

Correct:

```ts
import { Hono } from "hono";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

app.get("/api/users", async (c) => {
	const [errors, users] = await Server({...})
		.Connect(["DB1", "DB2"])
		... // pipeline
		.Output(MergeOutputStrategy());

	if (errors.length > 0) {
		return c.json({
			warning: "Partial results",
			errors: errors.map(e => ({
				database: e.database,
				message: e.error.message
			})),
			users
		}, 207); // Multi-Status
	}

	return c.json({ count: users.length, users });
});
```

Always check `errors.length` and return an appropriate HTTP status. For partial failures across multiple databases, `207 Multi-Status` or `500` with error details is appropriate.
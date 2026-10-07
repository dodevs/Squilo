---
name: setup-testcontainers
description: >
  Spin up Azure SQL Edge Docker containers via testcontainers for integration
  tests with Squilo. Configure Squilo with container host/port. Progress bar
  disabled in test env (NODE_ENV=test). Container lifecycle: beforeAll start,
  afterAll stop. Create test databases and seed data.
type: composition
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/test/container/container.ts"
  - "dodevs/Squilo:packages/squilo/test/container/setup/databases.ts"
  - "dodevs/Squilo:packages/squilo/test/index.spec.ts"
---

# Squilo — Setup Testcontainers

Use Docker containers with Azure SQL Edge for integration tests. Testcontainers manages container lifecycle automatically.

## Setup

```bash
bun add -d testcontainers
```

## Core Patterns

### Basic testcontainer with beforeAll/afterAll

```ts
import { expect, beforeAll, afterAll, describe, it } from "bun:test";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";

describe("Integration tests", async () => {
	const container = await AzureSqlEdge();

	const LocalServer = Server({
		server: container.getHost(),
		port: container.getMappedPort(1433),
		options: { encrypt: false }
	}).Auth(UserAndPassword("sa", SQL_PASSWORD));

	beforeAll(async () => {
		// Create test databases
		await SetupDatabases(container);
	});

	afterAll(async () => {
		await container.stop();
	});

	it("should query test database", async () => {
		const [, users] = await LocalServer
			.Connect("TestDB")
			.Retrieve(async (conn) => {
				const result = await conn.query`SELECT * FROM Users`;
				return result.recordset;
			})
			.Output(MergeOutputStrategy());

		expect(users.length).toBeGreaterThan(0);
	});
});
```

### Creating multiple test databases

```ts
import { AzureSqlEdge, SQL_PASSWORD } from "./container/container";

async function SetupDatabases(container: StartedTestContainer) {
	const server = container.getHost();
	const port = container.getMappedPort(1433);

	const pool = new ConnectionPool({
		server,
		port,
		user: "sa",
		password: SQL_PASSWORD,
		database: "master",
		options: { encrypt: false, trustServerCertificate: true }
	});
	await pool.connect();

	// Create test databases
	for (const db of ["TestDB1", "TestDB2", "TestDB3"]) {
		await pool.query`CREATE DATABASE ${db}`;
		await pool.query`
			USE ${db};
			CREATE TABLE Users (Id INT PRIMARY KEY, Name NVARCHAR(100), Email NVARCHAR(100));
		`;
	}

	await pool.close();
}
```

### Running tests with multiple database connections

```ts
import { expect, describe, it } from "bun:test";
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

describe("Multi-database tests", async () => {
	const container = await AzureSqlEdge();
	const LocalServer = Server({
		server: container.getHost(),
		port: container.getMappedPort(1433),
		options: { encrypt: false }
	}).Auth(UserAndPassword("sa", SQL_PASSWORD));

	it("should query across databases", async () => {
		const [, allUsers] = await LocalServer
			.Connect(["TestDB1", "TestDB2", "TestDB3"], 2)
			.Retrieve(async (conn, db) => {
				const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
				return result.recordset;
			})
			.Output(MergeOutputStrategy());

		expect(allUsers.length).toBeGreaterThan(0);
	});

	// Container stops automatically when process exits, or explicitly:
	// afterAll(async () => await container.stop());
});
```

## Common Mistakes

### HIGH Not awaiting container start before creating databases

Wrong:

```ts
import { AzureSqlEdge } from "./container/container";

const container = AzureSqlEdge(); // Returns Promise, not container
const server = container.getHost(); // TypeError: container.getHost is not a function
```

Correct:

```ts
import { AzureSqlEdge } from "./container/container";

const container = await AzureSqlEdge(); // Must await
const server = container.getHost();
const port = container.getMappedPort(1433);
```

`AzureSqlEdge()` returns a `Promise<StartedTestContainer>`. The container must be fully started before you can get the host and mapped port.

Source: packages/squilo/test/container/container.ts

### MEDIUM Progress bar appears during tests

Wrong:

```ts
// No NODE_ENV set — progress bar shows in test output
const [, users] = await LocalServer
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => { ... })
	.Output(MergeOutputStrategy());
```

Correct:

```ts
// In test setup or before running tests:
process.env.NODE_ENV = "test";

// Or in your test script:
// NODE_ENV=test bun test

const [, users] = await LocalServer
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => { ... })
	.Output(MergeOutputStrategy());
```

Squilo's runner checks `Bun.env.NODE_ENV !== 'test'` before starting the progress bar. Set `NODE_ENV=test` to keep test output clean.

Source: packages/squilo/src/pipes/shared/runner/index.ts

### MEDIUM Using wrong port after container restart

Wrong:

```ts
const container = await AzureSqlEdge();
const port1 = container.getMappedPort(1433);

// Container stops and restarts
await container.stop();
const container2 = await AzureSqlEdge();

// Still using old port
const server = Server({
	server: container2.getHost(),
	port: port1, // Wrong — new container has different mapped port
	options: { encrypt: false }
});
```

Correct:

```ts
const container = await AzureSqlEdge();

const server = Server({
	server: container.getHost(),
	port: container.getMappedPort(1433), // Always get fresh port
	options: { encrypt: false }
});
```

Docker randomizes host ports on each container start. Always call `getMappedPort(1433)` after the container is started, and never cache the port across container restarts.

Source: packages/squilo/test/container/container.ts
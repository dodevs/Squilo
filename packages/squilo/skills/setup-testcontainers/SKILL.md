---
name: setup-testcontainers
description: >
  Spin up Azure SQL Edge Docker containers via testcontainers for integration
  tests with Squilo. UseSqlServer(setup?) helper pattern: beforeAll start with
  its own hook timeout, wait until logins work, afterAll stop; server/container
  only usable inside tests or hooks. Progress bar disabled in test env
  (NODE_ENV=test). On Windows, run Bun tests in a Linux container (test:docker).
type: composition
library: squilo
library_version: "0.7.0-beta.3"
sources:
  - "dodevs/Squilo:packages/squilo/test/container/container.ts"
  - "dodevs/Squilo:packages/squilo/test/container/setup/databases.ts"
  - "dodevs/Squilo:packages/squilo/test/index.spec.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/shared/progress.ts"
  - "dodevs/Squilo:scripts/test-docker.ts"
---

# Squilo — Setup Testcontainers

Use Docker containers with Azure SQL Edge for integration tests. Squilo's own suite wraps the container lifecycle in a `UseSqlServer(setup?)` helper (`packages/squilo/test/container/container.ts`). It is not exported by `squilo`: copy the pattern below into your test folder.

## Setup

```bash
bun add -d testcontainers
```

## Core Patterns

### UseSqlServer helper (copy into your tests)

```ts
// test/sql-server.ts
import { afterAll, beforeAll } from "bun:test";
import { GenericContainer, type StartedTestContainer, Wait } from "testcontainers";
import { SQL, Server, UserAndPassword } from "squilo";

export const SQL_PASSWORD = "YourStrong@Passw0rd";

// bunfig's `timeout` only applies to tests; hooks need their own.
export const SQL_SERVER_TIMEOUT = 180_000;

export const CONFIG = (container: StartedTestContainer): SQL.config => ({
	server: container.getHost(),
	port: container.getMappedPort(1433),
	user: "sa",
	password: SQL_PASSWORD,
	options: { encrypt: false },
});

// "Recovery is complete" is logged before SQL Server accepts logins.
const waitForLogin = async (container: StartedTestContainer): Promise<void> => {
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			const conn = await new SQL.ConnectionPool({ ...CONFIG(container), database: "master" }).connect();
			await conn.close();
			return;
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await new Promise((resolve) => setTimeout(resolve, 1000));
		}
	}
};

export const UseSqlServer = (setup?: (container: StartedTestContainer) => Promise<void>) => {
	let container: StartedTestContainer | undefined;

	beforeAll(async () => {
		container = await new GenericContainer("mcr.microsoft.com/azure-sql-edge")
			.withEnvironment({ ACCEPT_EULA: "Y", MSSQL_SA_PASSWORD: SQL_PASSWORD })
			.withExposedPorts(1433)
			.withWaitStrategy(Wait.forLogMessage("Recovery is complete"))
			.start();
		await waitForLogin(container);
		await setup?.(container);
	}, SQL_SERVER_TIMEOUT);

	afterAll(async () => {
		await container?.stop();
	}, SQL_SERVER_TIMEOUT);

	const started = (): StartedTestContainer => {
		if (!container) throw new Error("SQL Server is not started yet: use it inside tests or hooks");
		return container;
	};

	return {
		get container() {
			return started();
		},
		get server() {
			const { server, port, options } = CONFIG(started());
			return Server({ server, port, options }).Auth(UserAndPassword("sa", SQL_PASSWORD));
		},
	};
};
```

### Using it in a test file

```ts
import { describe, expect, test } from "bun:test";
import { MergeOutputStrategy } from "squilo";
import { UseSqlServer } from "./sql-server";
import { DATABASES, SetupDatabases } from "./setup";

describe("Users", () => {
	// Registers beforeAll/afterAll; nothing is started yet
	const sql = UseSqlServer(SetupDatabases);

	test("queries every test database", async () => {
		const [errors, users] = await sql.server
			.Connect(DATABASES, 2)
			.Retrieve(async (conn) => {
				const result = await conn.query`SELECT * FROM dbo.Users`;
				return result.recordset;
			})
			.Output(MergeOutputStrategy());

		expect(errors).toEqual([]);
		expect(users.length).toBeGreaterThan(0);
	});
});
```

### Creating test databases (setup callback)

```ts
// test/setup.ts
import { SQL } from "squilo";
import type { StartedTestContainer } from "testcontainers";
import { CONFIG } from "./sql-server";

export const DATABASES = ["TestDB1", "TestDB2", "TestDB3"];

export const SetupDatabases = async (container: StartedTestContainer): Promise<void> => {
	const master = await new SQL.ConnectionPool({ ...CONFIG(container), database: "master" }).connect();
	for (const db of DATABASES) {
		// Plain string (not a tagged template) built from fixed names: identifiers can't be bound parameters
		await master.query(`CREATE DATABASE ${db}`);
	}
	await master.close();

	for (const db of DATABASES) {
		const conn = await new SQL.ConnectionPool({ ...CONFIG(container), database: db }).connect();
		await conn.query`CREATE TABLE Users (Id INT PRIMARY KEY, Name NVARCHAR(100), Email NVARCHAR(100))`;
		await conn.query`INSERT INTO Users (Id, Name, Email) VALUES (1, 'Alice', 'alice@example.com')`;
		await conn.close();
	}
};
```

## Common Mistakes

### HIGH Starting the container in an async describe body

Wrong:

```ts
describe("Integration tests", async () => {
	const container = await new GenericContainer("mcr.microsoft.com/azure-sql-edge")...start(); // Runs while tests are being collected
	const LocalServer = Server({ server: container.getHost(), ... }).Auth(...);
	// ...
});
```

Correct:

```ts
describe("Integration tests", () => {
	const sql = UseSqlServer(SetupDatabases); // Starts in beforeAll, stops in afterAll

	test("...", async () => {
		await sql.server.Connect("TestDB1").Execute(async (conn) => { ... });
	});
});
```

The describe body only registers tests and hooks. Start the container in `beforeAll` (with its own timeout) and stop it in `afterAll`, so it is always stopped, even when a test fails.

Source: packages/squilo/test/container/container.ts

### HIGH beforeAll without a hook timeout

Wrong:

```ts
// bunfig.toml: [test] timeout = 60000 — applies to tests only
beforeAll(async () => {
	container = await new GenericContainer("mcr.microsoft.com/azure-sql-edge")...start();
}); // Hook uses Bun's default timeout: fails while the image is pulled / SQL Server starts
```

Correct:

```ts
beforeAll(async () => {
	container = await new GenericContainer("mcr.microsoft.com/azure-sql-edge")...start();
	await waitForLogin(container);
}, SQL_SERVER_TIMEOUT); // e.g. 180_000

afterAll(async () => {
	await container?.stop();
}, SQL_SERVER_TIMEOUT);
```

`bunfig.toml`'s `timeout` only applies to tests. Hooks need their own timeout argument; pulling the image and starting SQL Server can take minutes on the first run.

Source: packages/squilo/test/container/container.ts

### HIGH Using sql.server at describe time

Wrong:

```ts
describe("Users", () => {
	const sql = UseSqlServer();
	const chain = sql.server.Connect("TestDB1"); // Error: SQL Server is not started yet
});
```

Correct:

```ts
describe("Users", () => {
	const sql = UseSqlServer();

	test("reads users", async () => {
		const chain = sql.server.Connect("TestDB1"); // Inside a test or hook
		// ...
	});
});
```

`beforeAll` has not run while the describe body executes, so the container does not exist yet. `sql.server` and `sql.container` only work inside tests or hooks.

Source: packages/squilo/test/container/container.ts

### MEDIUM Connecting as soon as the container reports ready

Wrong:

```ts
const container = await new GenericContainer("mcr.microsoft.com/azure-sql-edge")
	.withWaitStrategy(Wait.forLogMessage("Recovery is complete"))
	.start();
await SetupDatabases(container); // Intermittent "Login failed" right after startup
```

Correct:

```ts
const container = await new GenericContainer("mcr.microsoft.com/azure-sql-edge")
	.withWaitStrategy(Wait.forLogMessage("Recovery is complete"))
	.start();
await waitForLogin(container); // Retry a connection to master until a login works
await SetupDatabases(container);
```

SQL Server logs "Recovery is complete" before it accepts logins. Retry a login (as `waitForLogin` does) before creating databases or running Squilo against the container.

Source: packages/squilo/test/container/container.ts

### MEDIUM Running testcontainers under Bun on Windows

Wrong:

```bash
# Windows host: Docker listens on a named pipe Bun can't use
bun test
# Error: Could not find a working container runtime strategy
```

Correct:

```bash
# Run bun test inside a Linux Bun container that talks to the host's Docker
docker run --rm \
	-v /var/run/docker.sock:/var/run/docker.sock \
	--add-host=host.docker.internal:host-gateway \
	-e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal \
	--mount type=bind,source="$(pwd)",target=/app -w /app \
	oven/bun bun test
```

In the Squilo repo this is `bun run test:docker [bun test args...]` from the repo root.

Source: scripts/test-docker.ts

### MEDIUM Progress bar appears during tests

Wrong:

```bash
# .env sets NODE_ENV=development, so bun test keeps it and the progress bar is drawn
bun test
```

Correct:

```bash
# bun test sets NODE_ENV=test unless it is already set (environment or .env)
NODE_ENV=test bun test
```

Squilo's progress bar is silent when `Bun.env.NODE_ENV === "test"`. `bun test` sets that by default; only an explicit `NODE_ENV` (shell or `.env`) re-enables the bar.

Source: packages/squilo/src/pipes/shared/progress.ts
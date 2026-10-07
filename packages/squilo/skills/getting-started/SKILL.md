---
name: getting-started
description: >
  Interactive onboarding for Squilo: configure Server, Auth, Connect, Retrieve,
  Output. Generate first working script across multiple databases. Remind about
  process.exit() to prevent script hang. Install squilo and extension packages
  (msal-auth-strategy, xls-output-strategy).
type: lifecycle
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/README.md"
  - "dodevs/Squilo:packages/squilo/src/index.ts"
---

# Squilo — Getting Started

Generate your first working Squilo script. This skill walks through the complete pipeline: Server → Auth → Connect → Retrieve → Output.

## Setup

Install dependencies:

```bash
bun add squilo
```

For Azure AD authentication, also install:
```bash
bun add @squilo/msal-auth-strategy
```

For Excel output, also install:
```bash
bun add @squilo/xls-output-strategy
```

## Core Patterns

### First script: query a single database

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, users] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"))
	.Connect("YourDatabase")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT Id, Name, Email FROM Users WHERE Active = 1`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

if (errors.length > 0) {
	console.error("Failed databases:", errors);
}

console.log(`Found ${users.length} active users`);
process.exit(0); // Required — pools keep process alive
```

### Query across multiple databases

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, allUsers] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"))
	.Connect(["TenantDB1", "TenantDB2", "TenantDB3"], 2) // 2 concurrent
	.Retrieve(async (conn, db) => {
		const result = await conn.query`SELECT * FROM ${db}.dbo.Users`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

console.log(`Total users: ${allUsers.length}`);
process.exit(0);
```

### Discover databases dynamically

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const [errors, clients] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"))
	.Connect({
		database: "ClientsManager",
		query: `SELECT Database, ClientName FROM ActiveClients WHERE Region = 'US'`
	})
	.Retrieve(async (conn, db) => {
		const result = await conn.query`
			SELECT '${db.ClientName}' AS Client, * FROM ${db.Database}.dbo.Users
		`;
		return result.recordset;
	})
	.Output(MergeOutputStrategy());

console.log(clients);
process.exit(0);
```

## Common Mistakes

### CRITICAL Script hangs without process.exit()

Wrong:

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
// Script hangs here — no exit, pools and progress bar keep event loop alive
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
process.exit(0); // Required for standalone scripts
```

Connection pools and `cli-progress` SingleBar keep the Node.js/Bun event loop alive. Always call `process.exit(0)` at the end of standalone scripts. Not needed in web servers or long-running processes.

Source: packages/squilo/src/pipes/shared/runner/index.ts

### HIGH Wrong import path for extension packages

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";
import { ActiveDirectoryAccessToken } from "squilo/auth/strategies"; // Does not exist
import { XlsOutputStrategy } from "squilo/output/strategies"; // Does not exist
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";
```

The core `squilo` package has no subpath exports. It only exports from the main entry point (`"squilo"`). Extension packages use their own package names.

Source: packages/squilo/src/index.ts

### HIGH Forgetting to destructure Output() tuple

Wrong:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Output returns [ExecutionError[], result] — errors are lost
const users = await Server({
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
```

Correct:

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

// Destructure to capture both errors and result
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

if (errors.length > 0) {
	console.error("Some databases failed:", errors);
}
```

`.Output()` always returns a tuple `[ExecutionError[], result]`. Errors are in the first element, not thrown.

Source: packages/squilo/src/pipes/output/strategies/merge.ts

### MEDIUM Forgetting .Auth() after Server()

Wrong:

```ts
import { Server } from "squilo";

// Server() returns ServerChain — only .Auth() is available
const server = Server({ server: "localhost", port: 1433 });
const result = await server.Connect("MyDB"); // TypeError
```

Correct:

```ts
import { Server, UserAndPassword } from "squilo";

const server = Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"));
```

`Server()` must be chained with `.Auth(strategy)` before `.Connect()` is available.

Source: packages/squilo/src/pipes/server/types.ts
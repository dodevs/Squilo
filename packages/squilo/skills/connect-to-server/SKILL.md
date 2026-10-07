---
name: connect-to-server
description: >
  Configure Server() with hostname, port, encryption, trustServerCertificate.
  First step in the Squilo SQL Server pipeline. Returns ServerChain for .Auth().
  Use when an agent needs to set up a SQL Server connection before authentication.
type: core
library: squilo
library_version: "0.8.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/server/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/server/types.ts"
---

# Squilo — Connect to Server

Configure a SQL Server connection with `Server()`. This is the first step in the pipeline. `Server()` returns a `ServerChain` with one method: `.Auth(strategy)`.

## Setup

Minimum local development configuration:

```ts
import { Server } from "squilo";

const LocalServer = Server({
	server: "localhost",
	port: 1433,
	options: {
		encrypt: false,
		trustServerCertificate: true
	}
});
```

## Core Patterns

### Connect to Azure SQL Database

```ts
import { Server } from "squilo";

const AzureServer = Server({
	server: "mydb.database.windows.net",
	port: 1433,
	options: {
		encrypt: true
	}
});
```

### Connect with custom timeout

```ts
import { Server } from "squilo";

const CustomServer = Server({
	server: "192.168.1.100",
	port: 14333,
	connectionTimeout: 30000,
	requestTimeout: 30000,
	options: {
		encrypt: false
	}
});
```

## Common Mistakes

### HIGH Forgetting .Auth() after Server()

Wrong:

```ts
import { Server } from "squilo";

// Chain is incomplete — Connect is not available
const server = Server({ server: "localhost", port: 1433 });
server.Connect("MyDB"); // TypeError: server.Connect is not a function
```

Correct:

```ts
import { Server } from "squilo";
import { UserAndPassword } from "squilo";

const server = Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"));
```

`Server()` returns `ServerChain` which only exposes `.Auth()`. Authentication is mandatory.

Source: packages/squilo/src/pipes/server/types.ts

### MEDIUM Confusing Server() with web server frameworks

Wrong:

```ts
import { Server } from "squilo";
// Agent assumes this is an HTTP server like Hono or Express
const app = Server({ server: "localhost" });
app.get("/users", () => { /* ... */ });
```

Correct:

```ts
import { Server } from "squilo";

// Server() is a SQL Server connection factory, not an HTTP server
const DbServer = Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"));
```

`Server()` configures a connection to Microsoft SQL Server. It has no HTTP methods.

Source: packages/squilo/src/pipes/server/index.ts

### MEDIUM Wrong encrypt setting for local development

Wrong:

```ts
import { Server } from "squilo";

const LocalServer = Server({
	server: "localhost",
	port: 1433
	// Missing options.encrypt — defaults may not work for local SQL Server
});
```

Correct:

```ts
import { Server } from "squilo";

const LocalServer = Server({
	server: "localhost",
	port: 1433,
	options: {
		encrypt: false,
		trustServerCertificate: true
	}
});
```

For local SQL Server or Docker containers, `encrypt: false` and `trustServerCertificate: true` are typically required. For Azure SQL Database and production, use `encrypt: true`.

Source: packages/squilo/src/pipes/server/types.ts
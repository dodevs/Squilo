---
name: setup-authentication
description: >
  Configure SQL authentication with UserAndPassword (core) or Azure AD with
  ActiveDirectoryAccessToken from @squilo/msal-auth-strategy. Chained after
  Server(). Returns AuthenticationChain with Connect(). MSAL token caching
  via .active-directory-cache/ folder.
type: core
library: squilo
library_version: "0.7.0-beta.3"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/auth/index.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/auth/strategies/userAndPassword.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/auth/strategies/types.ts"
  - "dodevs/Squilo:packages/msal-auth-strategy/src/msal.ts"
---

# Squilo — Setup Authentication

Configure authentication for your SQL Server connection. `Auth(strategy)` is chained after `Server()` and returns an `AuthenticationChain` with `.Connect()`.

## Setup

SQL Server authentication with username and password:

```ts
import { Server, UserAndPassword } from "squilo";

const LocalServer = Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"));
```

## Core Patterns

### Azure Active Directory authentication

```ts
import { Server } from "squilo";
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

const AzureServer = Server({
	server: "mydb.database.windows.net",
	port: 1433,
	options: { encrypt: true }
}).Auth(await ActiveDirectoryAccessToken({
	clientId: process.env.AZURE_CLIENT_ID!,
	clientSecret: process.env.AZURE_CLIENT_SECRET!,
	authority: "https://login.microsoftonline.com/your-tenant-id"
}));
```

Requires `bun add @squilo/msal-auth-strategy`.

### Standalone MSAL token acquisition

```ts
import { GetToken } from "@squilo/msal-auth-strategy";

const token = await GetToken({
	clientId: process.env.AZURE_CLIENT_ID!,
	clientSecret: process.env.AZURE_CLIENT_SECRET!,
	authority: "https://login.microsoftonline.com/your-tenant-id"
});

// Use token outside of Squilo pipeline
console.log("Access token:", token);
```

### Using environment variables for credentials

```ts
import { Server, UserAndPassword } from "squilo";

const ServerConfig = Server({
	server: process.env.DB_SERVER!,
	port: parseInt(process.env.DB_PORT || "1433"),
	options: { encrypt: process.env.DB_ENCRYPT === "true" }
}).Auth(UserAndPassword(
	process.env.DB_USER!,
	process.env.DB_PASSWORD!
));
```

## Common Mistakes

### HIGH Importing ActiveDirectoryAccessToken from wrong package

Wrong:

```ts
import { Server } from "squilo";
import { ActiveDirectoryAccessToken } from "squilo"; // Not exported from core

const server = Server({...}).Auth(await ActiveDirectoryAccessToken({...}));
```

Correct:

```ts
import { Server } from "squilo";
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

const server = Server({...}).Auth(await ActiveDirectoryAccessToken({...}));
```

Azure AD authentication lives in the `@squilo/msal-auth-strategy` package, not the core `squilo` package.

Source: packages/squilo/src/index.ts

### HIGH Forgetting await on ActiveDirectoryAccessToken

Wrong:

```ts
import { Server } from "squilo";
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

// ActiveDirectoryAccessToken returns Promise<AuthStrategy>
const server = Server({...}).Auth(ActiveDirectoryAccessToken({...}));
// TypeError: Auth expects AuthStrategy, got Promise<AuthStrategy>
```

Correct:

```ts
import { Server } from "squilo";
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

const server = Server({...}).Auth(await ActiveDirectoryAccessToken({...}));
```

`ActiveDirectoryAccessToken()` is async — it acquires a token from Azure AD before returning the `AuthStrategy`.

Source: packages/msal-auth-strategy/src/msal.ts

### MEDIUM Installing only squilo but using Azure AD auth

Wrong:

```bash
bun add squilo
```

```ts
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";
// Module not found: @squilo/msal-auth-strategy not installed
```

Correct:

```bash
bun add squilo @squilo/msal-auth-strategy
```

Extension packages must be installed separately. They are not bundled with the core `squilo` package.

Source: packages/msal-auth-strategy/package.json

### MEDIUM Not understanding MSAL token cache lifecycle

Wrong:

```ts
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

// Re-authenticates interactively every run — slow and pops browser
const token1 = await ActiveDirectoryAccessToken({ clientId: "..." });
const token2 = await ActiveDirectoryAccessToken({ clientId: "..." });
```

Correct:

```ts
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

// First run: interactive auth (browser popup)
// Subsequent runs: silent auth from cache (.active-directory-cache/)
const authStrategy = await ActiveDirectoryAccessToken({ clientId: "..." });
```

MSAL caches tokens in `.active-directory-cache/<tenantId>-<clientId>.json`. Silent auth reads from cache; interactive auth writes to it. The cache file is created automatically on first successful authentication.

Source: packages/msal-auth-strategy/src/msal.ts
# @squilo/msal-auth-strategy

![npm version](https://img.shields.io/npm/v/@squilo/msal-auth-strategy)
![bun compatible](https://img.shields.io/badge/bun-v1.2.20%2B-blue)
![license](https://img.shields.io/github/license/dodevs/Squilo)

## Package Overview

Azure AD (Entra ID) interactive and silent authentication strategy for [Squilo](https://www.npmjs.com/package/squilo) pipelines. Uses [@azure/msal-node](https://www.npmjs.com/package/@azure/msal-node) to acquire access tokens via silent token cache or interactive browser flow.

## Installation

```bash
bun add squilo @squilo/msal-auth-strategy
```

## Usage

Use `ActiveDirectoryAccessToken` as an auth strategy in your Squilo pipeline:

```ts
import { Server, MergeOutputStrategy } from "squilo";
import { ActiveDirectoryAccessToken } from "@squilo/msal-auth-strategy";

const AzureServer = Server({
    server: "your-server.database.windows.net",
    options: { encrypt: true }
}).Auth(await ActiveDirectoryAccessToken({
    clientId: process.env.AZURE_CLIENT_ID!,
    clientSecret: process.env.AZURE_CLIENT_SECRET!,
    authority: "https://login.microsoftonline.com/your-tenant-id"
}));

const [errors, users] = await AzureServer
    .Connect("YourDatabase")
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users`;
    })
    .Output(MergeOutputStrategy());
```

## Standalone Token Acquisition

Use `GetToken` directly when you need an Azure AD access token outside of a Squilo pipeline:

```ts
import { GetToken } from "@squilo/msal-auth-strategy";

const token = await GetToken({
    clientId: process.env.AZURE_CLIENT_ID!,
    clientSecret: process.env.AZURE_CLIENT_SECRET!,
    authority: "https://login.microsoftonline.com/your-tenant-id"
});

console.log(`Access token: ${token}`);
```

## Token Caching

Tokens are cached in a `.active-directory-cache/` folder in your project root. Cache files are named with a hash of `tenantId-clientId` (e.g., `.active-directory-cache/your-tenant-id-your-client-id.json`).

**Authentication flow:**

1. **Silent flow** — If a cached token exists and is valid, it is used automatically with no user interaction.
2. **Interactive fallback** — If the silent flow fails (expired or missing cache), an interactive browser flow is triggered. A browser window opens for the user to authenticate, then closes automatically on success.

The cache is automatically updated after each successful interactive authentication.

## Dependencies

- `@azure/msal-node` — Microsoft Authentication Library for Node.js
- `open` — Cross-platform browser opener for interactive flow
- `squilo` — Peer dependency (the core pipeline library)

## Related

- [squilo](https://www.npmjs.com/package/squilo) — Core pipeline library
- [@squilo/xls-output-strategy](https://www.npmjs.com/package/@squilo/xls-output-strategy) — Excel output strategy

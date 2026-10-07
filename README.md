# Squilo

![squilo npm](https://img.shields.io/npm/v/squilo)
![msal-auth-strategy npm](https://img.shields.io/npm/v/@squilo/msal-auth-strategy)
![xls-output-strategy npm](https://img.shields.io/npm/v/@squilo/xls-output-strategy)
![bun compatible](https://img.shields.io/badge/bun-v1.2.20%2B-blue)
![license](https://img.shields.io/github/license/dodevs/Squilo)

Squilo is a Bun-first TypeScript library for orchestrating SQL Server connections, authentication, and script execution with modern TypeScript patterns. Built for multi-database scenarios — multi-tenant SaaS, batch jobs, migrations, and reporting.

## Monorepo Packages

| Package | Description | README |
|---|---|---|
| [`squilo`](https://www.npmjs.com/package/squilo) | Core pipeline library — Server, Auth, Connect, Retrieve, Execute, Transform, Output | [packages/squilo](https://github.com/dodevs/Squilo/tree/main/packages/squilo#readme) |
| [`@squilo/msal-auth-strategy`](https://www.npmjs.com/package/@squilo/msal-auth-strategy) | Azure AD (Entra ID) interactive/silent authentication | [packages/msal-auth-strategy](https://github.com/dodevs/Squilo/tree/main/packages/msal-auth-strategy#readme) |
| [`@squilo/xls-output-strategy`](https://www.npmjs.com/package/@squilo/xls-output-strategy) | Excel (.xlsx) output with separate or combined sheets | [packages/xls-output-strategy](https://github.com/dodevs/Squilo/tree/main/packages/xls-output-strategy#readme) |

## Quick Start

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";

const LocalServer = Server({
    server: "localhost",
    port: 1433,
    options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"));

const [errors, activeUsers] = await LocalServer
    .Connect("YourDatabase")
    .Retrieve(async (connection) => {
        const result = await connection.query`
            SELECT Id, Name, Email FROM Users WHERE Active = 1
        `;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());

console.log(`Found ${activeUsers.length} active users`);
```

## Working with the Monorepo

```bash
# Install all workspace dependencies
bun install

# Build all packages
bun run build

# Run all tests (SQL Server specs need Docker)
bun run test
bun run test:watch

# Run the suite inside a Linux Bun container (for hosts where Bun can't reach Docker, e.g. Windows)
bun run test:docker

# Format code
bun run format
```

Run single specs from the repository root (running inside a package skips the root `bunfig.toml`):

```bash
bun test ./packages/squilo/test/connect.spec.ts
bun test ./packages/xls-output-strategy/test/xls.spec.ts
```

Build per package:

```bash
cd packages/squilo && bun run build
cd packages/msal-auth-strategy && bun run build
cd packages/xls-output-strategy && bun run build
```

## AI Agent Support

If you use an AI coding agent (Claude Code, Cursor, Copilot, etc.), install the Squilo intent skills for task-focused guidance across the entire pipeline:

```bash
npx @tanstack/intent@latest install
```

This provides 14 skills covering: server configuration, authentication, database connections, data retrieval, transformations, output strategies, error handling, custom strategies, HonoJS integration, testcontainers setup, getting started guides, and report generation.

## Links

- [Full documentation](https://github.com/dodevs/Squilo/tree/main/packages/squilo#readme)
- [Contributing](https://github.com/dodevs/Squilo)
- [License](https://github.com/dodevs/Squilo) (MIT)

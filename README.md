# Squilo

![npm version](https://img.shields.io/npm/v/squilo)
![bun compatible](https://img.shields.io/badge/bun-v1.2.20%2B-blue)
![license](https://img.shields.io/github/license/douglasdasilvasousa/squilo)

Squilo is a Bun-first library for orchestrating SQL Server connections, authentication, and script execution with modern TypeScript patterns.

## Getting Started

### Initialize a Bun Project

```bash
bun init
```

### Add Squilo as a Production Dependency

```bash
bun add squilo
```

## Usage Example

### Exportable Servers (Production, Dev, ...)

```ts
// src/server.ts
import { Server } from "squilo";

export const ProdServer = Server({
  server: "prod-host",
  port: 1433,
  options: { encrypt: true }
});

export const DevServer = Server({
  server: "localhost",
  port: 1433,
  options: { encrypt: false }
});
```

### Exportable Authentications

```ts
// src/auth.ts
import { UserAndPassword } from "squilo/pipes/auth/strategies";

export const ProdAuth = UserAndPassword("prod_user", "prod_pass");
export const DevAuth = UserAndPassword("sa", "your_dev_password");
```

### Create Scripts

```ts
// scripts/fixEmails.ts
import { ProdServer } from "../src/server";
import { ProdAuth } from "../src/auth";

await ProdServer.Auth(ProdAuth)
  .Connect(["db1", "db2"])
  .Execute(async (transaction) => {
    await transaction.request().query`
      UPDATE Users SET Email = RTRIM(Email)
    `;
  });
```

### Run Scripts Using Bun

```bash
bun run scripts/fixEmails.ts
```

## Advanced Usage

- Use `.Input()` to provide dynamic input for scripts
- Use `.Retrieve()` to fetch results from databases
- Use `.Output()` strategies to merge or format results

## Reference

See the [test suite](./test/) for more advanced usage and orchestration patterns.

---

This project was created using `bun init` in bun v1.2.20. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

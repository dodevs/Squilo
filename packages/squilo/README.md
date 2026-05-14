# Squilo

![npm version](https://img.shields.io/npm/v/squilo)
![bun compatible](https://img.shields.io/badge/bun-v1.2.20%2B-blue)
![license](https://img.shields.io/github/license/dodevs/Squilo)

## Package Overview

`squilo` is the core library for orchestrating SQL Server connections, authentication, and script execution with modern TypeScript patterns. It provides a fluent pipeline API that chains operations from server configuration through to output strategies.

**Pipeline Architecture:**
```
Server(config) → .Auth(strategy) → .Connect(db/dbs/query) → .Retrieve(fn) or .Execute(fn) → [.Transform(fn)] → .Output(strategy)
```

**Key Features:**
- ✅ **Bun-first**: Built for Bun runtime with optimal performance
- ✅ **Connection pooling**: Automatic pool management with configurable concurrency
- ✅ **Multi-database orchestration**: Process hundreds of databases efficiently
- ✅ **Early connection release**: Transform pipe closes DB connections before expensive operations
- ✅ **Flexible output**: Built-in JSON, Console, Merge + custom strategies
- ✅ **Type-safe**: Full TypeScript support with proper generics
- ✅ **Production-ready**: Error handling, progress bars (in non-test env), transaction support

**Use Cases:**
- Multi-tenant SaaS applications with per-client databases
- Scheduled batch jobs across multiple database instances
- Data migrations and synchronization scripts
- Report generation and analytics pipelines
- Database maintenance operations

## Installation

```bash
bun add squilo
```

**Optional add-on packages:**
- For Azure AD authentication: [`@squilo/msal-auth-strategy`](https://www.npmjs.com/package/@squilo/msal-auth-strategy)
- For Excel output: [`@squilo/xls-output-strategy`](https://www.npmjs.com/package/@squilo/xls-output-strategy)

## Quick Example

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

if (errors.length > 0) {
    console.error('Failed to retrieve users:', errors);
    process.exit(1);
}

console.log(`Found ${activeUsers.length} active users`);
```

## Basic Usage

### Connect to a Single Database

```ts
import { Server, UserAndPassword } from "squilo";

const LocalServer = Server({
    server: "localhost",
    port: 1433,
    options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"));

const connectionChain = LocalServer.Connect("YourDatabase");
```

### Simple Update: Fix Email Formatting

```ts
const errors = await LocalServer
    .Connect("YourDatabase")
    .Execute(async (connection) => {
        await connection.query`
            UPDATE Users 
            SET Email = LTRIM(RTRIM(Email))
            WHERE Email LIKE ' %' OR Email LIKE '% '
        `;
    });

if (errors.length > 0) {
    console.error('Email cleanup failed:', errors);
} else {
    console.log('Email formatting fixed successfully');
}
```

### Simple Retrieve: Count Active Users

```ts
import { MergeOutputStrategy } from "squilo";

const [errors, results] = await LocalServer
    .Connect("YourDatabase")
    .Retrieve(async (connection) => {
        const result = await connection.query<{ activeCount: number }>`
            SELECT COUNT(*) as activeCount FROM Users WHERE Active = 1
        `;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());

if (errors.length === 0 && results.length > 0) {
    console.log(`Active users: ${results[0].activeCount}`);
}
```

## Server Configurations

Squilo accepts all [mssql configuration options](https://tediousjs.github.io/tedious/api-connection.html) except `authentication`, `user`, and `password` (which are managed by auth strategies):

```ts
// Production config with full options
const Production = Server({
    server: process.env.DB_SERVER!,        // Required: server hostname
    port: Number(process.env.DB_PORT) || 1433,
    database: "master",                    // Default database (overridden by Connect)
    options: {
        encrypt: true,                     // SSL encryption
        trustServerCertificate: false,    // Validate certificate
        enableArithAbort: true
    },
    pool: {
        max: 50,                          // Max connections in pool
        min: 0,                           // Min connections to keep
        idleTimeoutMillis: 30000         // 30 second idle timeout
    },
    requestTimeout: 300000,               // 5 minute query timeout
    cancelTimeout: 5000                   // 5 second cancel timeout
});
```

## Different Methods of Connecting to Databases

Squilo supports three ways to specify target databases:

### 1. Single Database (String)

```ts
const singleDb = LocalServer.Connect("MyDatabase");
const [errors, data] = await singleDb
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users`;
    })
    .Output(MergeOutputStrategy());
```

### 2. Multiple Databases (Array)

```ts
const databases = ["Client1", "Client2", "Client3"];

// Process all databases (concurrent by default)
const [errors, allData] = await LocalServer
    .Connect(databases)
    .Retrieve(async (conn, db) => {
        return await conn.query`SELECT * FROM ${db}.Users`;
    })
    .Output(MergeOutputStrategy());

// Process with concurrency limit (e.g., 5 at a time)
const [errors, limitedData] = await LocalServer
    .Connect(databases, 5)
    .Retrieve(async (conn, db) => {
        return await conn.query`SELECT * FROM ${db}.Users`;
    })
    .Output(MergeOutputStrategy());
```

### 3. Dynamic Database Discovery (Query)

```ts
interface DiscoveredDB {
    Database: string;
    IsActive: boolean;
    Region: string;
}

const [errors, data] = await LocalServer
    .Connect<DiscoveredDB>({
        database: "ManagerDB",
        query: `SELECT DatabaseName AS [Database], Active AS IsActive, Region 
                FROM ActiveClients 
                WHERE Status = 'Active' ORDER BY Priority`
    })
    .Retrieve(async (conn, dbInfo) => {
        console.log(`Processing ${dbInfo.Database} in ${dbInfo.Region}`);
        
        const result = await conn.query`
            SELECT Id, Name, Email, CreatedAt 
            FROM Users 
            WHERE Active = 1
        `;
        
        return result.recordset.map(user => ({
            ...user,
            Database: dbInfo.Database,
            DatabaseRegion: dbInfo.Region,
            IsActiveTenant: dbInfo.IsActive
        }));
    })
    .Output(MergeOutputStrategy());
```

## Authentication

### SQL Username/Password

```ts
import { UserAndPassword } from "squilo";

const ServerWithAuth = Server(config)
    .Auth(UserAndPassword("username", "password"));
```

> **Azure AD Authentication:** For Azure AD (Entra ID) interactive/silent authentication, install [`@squilo/msal-auth-strategy`](https://www.npmjs.com/package/@squilo/msal-auth-strategy).

### Creating Custom Authentication Strategies

Implement the `AuthStrategy` type: `(config: ServerConfig) => config`

```ts
import type { AuthStrategy } from "squilo";

// Certificate-based authentication
const CertificateAuth = (certPath: string, keyPath: string): AuthStrategy => {
    return (config) => ({
        ...config,
        authentication: {
            type: 'certificate',
            options: {
                cert: Bun.file(certPath),
                key: Bun.file(keyPath)
            }
        }
    });
};

// Custom token from secure vault
const VaultTokenAuth = async (): Promise<AuthStrategy> => {
    const token = await fetchTokenFromVault();
    return (config) => ({
        ...config,
        authentication: {
            type: 'azure-active-directory-access-token',
            options: { token }
        }
    });
};

// Use custom auth
const CustomServer = Server(config).Auth(CertificateAuth("./cert.pem", "./key.pem"));
```

## Retrieve Operations

### Simple Query

```ts
const [errors, users] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        const result = await connection.query`
            SELECT Id, Name, Email, CreatedAt 
            FROM Users 
            WHERE Active = 1
            ORDER BY CreatedAt DESC
        `;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());
```

### Using Transactions (CTE, TVP, Complex Operations)

Wrap operations in a transaction for atomicity using the `await using` pattern. Transactions auto-rollback if `commit$()` is not called:

```ts
import { Table, type Request } from "mssql";

const [errors, summary] = await LocalServer
    .Connect("AnalyticsDB")
    .Retrieve(async (connection) => {
        await using transaction = await connection.transaction$();
        
        const request = transaction.request();
        
        const result1 = await request.query`
            WITH MonthlyActive AS (
                SELECT user_id, MAX(activity_date) as last_active
                FROM user_activities
                WHERE activity_date >= DATEADD(month, -1, GETDATE())
                GROUP BY user_id
            )
            SELECT COUNT(*) as TotalActive
            FROM MonthlyActive
            `;

        const tvp = new Table('UserList');
        tvp.columns.add('Id', 'Int');
        tvp.columns.add('Name', 'NVarChar(100)');
        tvp.rows.add([1, 'Alice'], [2, 'Bob']);

        const result2 = await request
            .input('Users', tvp)
            .query`SELECT * FROM ProcessUsers(@Users)`;

        await request.query`
            INSERT INTO AuditLog (Action, Details)
            VALUES ('MonthlyActiveCalc', 'Processed ${result1.recordset[0]?.TotalActive} users')
        `;

        await transaction.commit$();
        
        return {
            activeCount: result1.recordset[0]?.TotalActive,
            processed: result2.recordset
        };
    })
    .Output(MergeOutputStrategy());
```

## Data Transformation

### Simple Transform: Do It Inline in Retrieve

For simple operations (formatting, calculated fields), transform directly in the Retrieve callback:

```ts
const [errors, users] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        const result = await connection.query`
            SELECT Id, Email, CreatedAt FROM Users WHERE Active = 1
        `;
        
        return result.recordset.map(user => ({
            ...user,
            Email: user.Email.toLowerCase().trim(),
            Initials: `${user.FirstName[0]}${user.LastName[0]}`,
            DaysActive: Math.floor((Date.now() - user.CreatedAt.getTime()) / (1000 * 60 * 60 * 24))
        }));
    })
    .Output(MergeOutputStrategy());
```

### Complex Transform: Use the Transform Pipe

Use `Transform` when you need to perform **expensive operations that don't require a database connection**. The Transform pipe releases DB connections immediately.

**When to use Transform:**
- ✅ External API calls (geolocation, CRM lookup)
- ✅ File I/O operations (image processing, PDF generation)
- ✅ CPU-intensive calculations

**When NOT to use Transform (do in Retrieve instead):**
- ❌ Simple string formatting
- ❌ Adding fields from existing data
- ❌ Basic array operations

#### Example: External API Enrichment

```ts
const [errors, enrichedUsers] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        return await connection.query`
            SELECT Id, Email, CountryCode FROM Users WHERE Active = 1
        `;
    })
    .Transform(async (users) => {
        const enriched = await Promise.allSettled(
            users.map(async (user) => {
                try {
                    const geo = await fetch(`https://api.example.com/geo/${user.CountryCode}`)
                        .then(r => r.json());
                    return { ...user, ...geo };
                } catch (error) {
                    return { ...user, enrichmentFailed: true };
                }
            })
        );
        
        return enriched.filter((result): result is PromiseFulfilledResult<any> => 
            result.status === 'fulfilled'
        ).map(r => r.value);
    })
    .Output(MergeOutputStrategy());
```

#### Example: File Processing

```ts
const [_, usersWithAvatars] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        return await connection.query<{ Id: number; AvatarPath: string }>`
            SELECT Id, AvatarPath FROM Users WHERE HasAvatar = 1
        `;
    })
    .Transform(async (users) => {
        const processed = await Promise.all(
            users.map(async (user) => {
                if (!user.AvatarPath) return user;
                
                try {
                    const imageBuffer = await Bun.file(user.AvatarPath).arrayBuffer();
                    const thumbnail = await generateThumbnail(imageBuffer, 64, 64);
                    return { ...user, Thumbnail: thumbnail };
                } catch {
                    return { ...user, ProcessingFailed: true };
                }
            })
        );
        return processed;
    })
    .Output(MergeOutputStrategy());
```

## Execute Operations

Execute returns `Promise<ExecutionError<T>[]>` — an array of errors for any databases that failed:

### Simple Update

```ts
const errors = await LocalServer
    .Connect("UsersDB")
    .Execute(async (connection) => {
        await connection.query`
            UPDATE Users 
            SET Status = 'Active' 
            WHERE LastLogin > DATEADD(day, -30, GETDATE())
        `;
    });

if (errors.length > 0) {
    console.error(`Failed on ${errors.length} databases:`, errors);
} else {
    console.log('Update completed successfully');
}
```

### Execute with Transaction$

```ts
const errors = await LocalServer
    .Connect("OrderDB")
    .Execute(async (connection) => {
        await using transaction = await connection.transaction$();
        const request = transaction.request();
        
        await request.query`UPDATE Inventory SET Quantity = Quantity - 1 WHERE ProductId = 123`;
        await request.query`INSERT INTO OrderHistory (ProductId, Quantity) VALUES (123, 1)`;
        
        await transaction.commit$();
    });
```

### Execute Across Multiple Databases

```ts
const allClientDBs = ["Client1", "Client2", "Client3", "Client4"];

const errors = await LocalServer
    .Connect(allClientDBs)
    .Execute(async (connection, database) => {
        await connection.query`
            UPDATE Users 
            SET Status = 'Active' 
            WHERE LastLogin > DATEADD(day, -30, GETDATE())
        `;
        
        await connection.query`
            UPDATE Settings 
            SET LastMaintenance = GETDATE() 
            WHERE DatabaseName = '${database}'
        `;
    });

if (errors.length === 0) {
    console.log(`✅ Successfully updated all ${allClientDBs.length} databases`);
} else {
    console.error(`❌ Failed on ${errors.length}/${allClientDBs.length} databases:`);
    errors.forEach(err => {
        console.error(`  - ${err.database}: ${err.error.message}`);
    });
}
```

## Output Strategies (Built-in)

The `Output()` method finalizes your pipeline and returns results.

### MergeOutputStrategy (In-Memory Merge)

Merges all results from multiple databases into a single array:

```ts
import { MergeOutputStrategy } from "squilo";

const [errors, mergedData] = await LocalServer
    .Connect(["DB1", "DB2", "DB3"])
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users WHERE Active = 1`;
    })
    .Output(MergeOutputStrategy());
```

### JsonOutputStrategy (File Export)

Writes results to a JSON file:

```ts
import { JsonOutputStrategy } from "squilo";

const [errors, filename] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users`;
    })
    .Output(JsonOutputStrategy({
        includeEmpty: true,
        includeErrors: false
    }));
```

### ConsoleOutputStrategy (Debugging)

Logs results to console. Returns `void`:

```ts
import { ConsoleOutputStrategy } from "squilo";

await LocalServer
    .Connect("TestDB")
    .Retrieve(async (conn) => {
        return await conn.query`SELECT TOP 5 * FROM Users`;
    })
    .Output(ConsoleOutputStrategy());
```

> **Excel Output:** For Excel (.xlsx) export with separate or combined sheets, install [`@squilo/xls-output-strategy`](https://www.npmjs.com/package/@squilo/xls-output-strategy).

## Creating Custom Output Strategies

Implement the `OutputStrategy<T, TReturn, TOutput>` type:

```ts
import type { OutputStrategy, ExecutionResult } from "squilo";

const CsvOutputStrategy = <T, TData>(): OutputStrategy<T, TData, string> => {
    return async (result): Promise<string> => {
        let csv = 'Database,Data\n';
        
        for await (const { database, data, error } of result) {
            if (error) continue;
            
            if (Array.isArray(data)) {
                data.forEach(row => {
                    const csvLine = Object.values(row)
                        .map(v => `"${String(v).replace(/"/g, '""')}"`)
                        .join(',');
                    csv += `${String(database)},${csvLine}\n`;
                });
            }
        }
        
        return csv;
    };
};

const csvData = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (conn) => conn.query`SELECT * FROM Users`)
    .Output(CsvOutputStrategy());
```

### Aggregating Results from Multiple Databases

When you use `MergeOutputStrategy()` with multiple databases, you get a flattened array. You can aggregate this data after retrieval:

```ts
const allDatabases = ["Client1", "Client2", "Client3", "Client4"];

const [errors, results] = await LocalServer
    .Connect(allDatabases)
    .Retrieve(async (connection, db) => {
        const result = await connection.query<{ activeCount: number }>`
            SELECT COUNT(*) as activeCount FROM Users WHERE Active = 1
        `;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());

if (errors.length === 0) {
    const totalActiveUsers = results.reduce((sum, db) => sum + db.activeCount, 0);
    console.log(`Total active users: ${totalActiveUsers}`);
}
```

## The includeErrors Parameter

Some strategies support `includeErrors: true` which changes the return type:

**Without includeErrors (default):**
```ts
const [errors, result] = await chain.Output(JsonOutputStrategy());
// Type: [ExecutionError[], string]
```

**With includeErrors: true:**
```ts
const filename = await chain.Output(JsonOutputStrategy({ includeErrors: true }));
// Type: string (errors embedded in output file)
```

## Comparison: Transform vs Inline Processing

| Aspect | Inline in Retrieve | Transform Pipe |
|--------|-------------------|----------------|
| **DB Connection** | Held during processing | Released before processing |
| **Use Case** | Simple, fast operations | Expensive async operations |
| **Examples** | Formatting, calculations | API calls, file I/O, CPU-intensive |
| **Connection Pool** | Blocks until complete | Released immediately |

```ts
// Inline (simple, efficient)
const [_, users1] = await LocalServer
    .Connect("DB")
    .Retrieve(async (conn) => {
        const result = await conn.query`SELECT * FROM Users`;
        return result.recordset.map(u => ({ ...u, Email: u.Email.toLowerCase() }));
    })
    .Output(MergeOutputStrategy());

// Transform (releases DB connection early)
const [_, users2] = await LocalServer
    .Connect("DB")
    .Retrieve(async (conn) => conn.query`SELECT * FROM Users`)
    .Transform(users => users.map(u => ({ ...u, Email: u.Email.toLowerCase() })))
    .Output(MergeOutputStrategy());
```

## Configuration & Environment

### Configuration Options

```ts
interface ServerConfig {
    server: string;           // Server hostname (required)
    port?: number;            // Default: 1433
    database?: string;        // Default database
    options?: {
        encrypt?: boolean;
        trustServerCertificate?: boolean;
        enableArithAbort?: boolean;
    };
    pool?: {
        max?: number;         // Default: 10
        min?: number;
        idleTimeoutMillis?: number;
    };
    requestTimeout?: number;  // Default: 15000ms
    cancelTimeout?: number;   // Default: 5000ms
}
```

### Environment Variables

- **`SAFE_GUARD`** — Maximum number of database failures to tolerate before skipping all remaining databases (default: `1`):
  ```bash
  SAFE_GUARD=5 bun run scripts/process-clients.ts
  ```

- **`NODE_ENV`** — Set to `test` to disable progress bars:
  ```bash
  NODE_ENV=test bun test
  ```

## API Reference

### Source Code Structure

```
src/
├── index.ts              # Re-exports Server + mssql as SQL
├── pool/
│   └── index.ts          # ConnectionPoolWrapper, TransactionWrapper
├── pipes/
│   ├── server/           # Server configuration
│   ├── auth/             # Auth pipe + UserAndPassword strategy
│   ├── connect/          # Database connection handling
│   ├── retrieve/         # Data retrieval operations
│   ├── execute/          # Data modification operations
│   ├── transform/        # Post-processing pipeline
│   ├── output/           # Output pipe + built-in strategies
│   └── shared/runner/    # Connection execution engine
```

### Type Exports

```ts
// Core types
import type { AuthStrategy } from "squilo";
import type { OutputStrategy, ExecutionResult, ExecutionError } from "squilo";

// mssql re-exported as SQL
import { SQL, type ConnectionPool, type Transaction, type Request } from "squilo";
```

## Testing

```bash
bun test
```

The `test/` directory contains comprehensive examples of:
- Multi-database orchestration patterns
- Error handling and recovery
- Transaction management
- Transform pipeline usage
- All output strategies

Tests use [testcontainers](https://testcontainers.com/) with an Azure SQL Edge Docker image.

## Related Packages

- [`@squilo/msal-auth-strategy`](https://www.npmjs.com/package/@squilo/msal-auth-strategy) — Azure AD (Entra ID) authentication
- [`@squilo/xls-output-strategy`](https://www.npmjs.com/package/@squilo/xls-output-strategy) — Excel (.xlsx) output

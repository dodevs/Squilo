# Squilo

![npm version](https://img.shields.io/npm/v/squilo)
![bun compatible](https://img.shields.io/badge/bun-v1.2.20%2B-blue)
![license](https://img.shields.io/github/license/douglasdasilvasousa/squilo)

## Library Presentation

Squilo is a Bun-first library for orchestrating SQL Server connections, authentication, and script execution with modern TypeScript patterns. It's designed for scenarios where you need to:

- **Execute operations across multiple databases** (multi-tenant applications, client databases, sharded systems)
- **Orchestrate complex database workflows** with connection pooling and automatic resource management
- **Release database connections quickly** while performing expensive post-processing
- **Produce multiple output formats** (JSON, Excel, CSV, custom) with merged results
- **Support various authentication methods** (SQL auth, Azure AD, custom strategies)

**Key Features:**
- ✅ **Bun-first**: Built for Bun runtime with optimal performance
- ✅ **Pipeline architecture**: Chainable methods: `Server → Auth → Connect → Retrieve/Execute → Transform (optional) → Output`
- ✅ **Connection pooling**: Automatic pool management with configurable concurrency
- ✅ **Multi-database orchestration**: Process hundreds of databases efficiently
- ✅ **Early connection release**: Transform pipe closes DB connections before expensive operations
- ✅ **Flexible output**: Built-in JSON, Excel, Console, Merge + custom strategies
- ✅ **Type-safe**: Full TypeScript support with proper generics
- ✅ **Production-ready**: Error handling, progress bars (in non-test env), transaction support

**Use Cases:**
- Multi-tenant SaaS applications with per-client databases
- Scheduled batch jobs across multiple database instances
- Data migrations and synchronization scripts
- Report generation and analytics pipelines
- Database maintenance operations

---

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) v1.2.20+
- SQL Server (local, on-premise, or Azure)
- TypeScript knowledge

### Installation

```bash
# Initialize Bun project (if you haven't already)
bun init

# Add Squilo as dependency
bun add squilo
```

### Quick Example

Here's a minimal example to get you started:

```ts
// scripts/get-active-users.ts
import { Server } from "squilo";
import { UserAndPassword } from "squilo/auth/strategies";
import { MergeOutputStrategy } from "squilo/output/strategies";

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

Run it:
```bash
bun run scripts/get-active-users.ts
```

---

## Basic Usage

### Connect to a Single Database

```ts
import { Server } from "squilo";
import { UserAndPassword } from "squilo/auth/strategies";

const LocalServer = Server({
    server: "localhost",
    port: 1433,
    options: { encrypt: false }
}).Auth(UserAndPassword("sa", "your-password"));

// Simple connection to one database
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
import { MergeOutputStrategy } from "squilo/output/strategies";

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

---

## Advanced Usage

### Server Configurations

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

### Different Methods of Connecting to Databases

Squilo supports three ways to specify target databases:

#### 1. Single Database (String)

```ts
const singleDb = LocalServer.Connect("MyDatabase");
const [errors, data] = await singleDb
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users`;
    })
    .Output(MergeOutputStrategy());
```

#### 2. Multiple Databases (Array)

```ts
const databases = ["Client1", "Client2", "Client3"];

// Process all databases (concurrent by default)
const [errors, allData] = await LocalServer
    .Connect(databases)  // No concurrent limit = process all at once
    .Retrieve(async (conn, db) => {
        const result = await conn.query`SELECT * FROM ${db}.Users`;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());

// Process with concurrency limit (e.g., 5 at a time)
const [errors, limitedData] = await LocalServer
    .Connect(databases, 5)  // Process 5 databases simultaneously
    .Retrieve(async (conn, db) => {
        return await conn.query`SELECT * FROM ${db}.Users`;
    })
    .Output(MergeOutputStrategy());
```

#### 3. Dynamic Database Discovery (Query)

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
        // dbInfo contains the Database (required) plus any extra properties from query
        console.log(`Processing ${dbInfo.Database} in ${dbInfo.Region} (Active: ${dbInfo.IsActive})`);
        
        const result = await conn.query`
            SELECT Id, Name, Email, CreatedAt 
            FROM Users 
            WHERE Active = 1
        `;
        
        // Add database metadata to each record for downstream processing
        return result.recordset.map(user => ({
            ...user,
            Database: dbInfo.Database,
            DatabaseRegion: dbInfo.Region,
            IsActiveTenant: dbInfo.IsActive
        }));
    })
    .Output(MergeOutputStrategy());
// Returns enriched user data with Database, DatabaseRegion, IsActiveTenant fields
```

### Authentication Strategies

Squilo provides built-in authentication strategies:

#### SQL Username/Password

```ts
import { UserAndPassword } from "squilo/auth/strategies";

const ServerWithAuth = Server(config)
    .Auth(UserAndPassword("username", "password"));
```

#### Azure AD Access Token

```ts
import { ActiveDirectoryAccessToken } from "squilo/auth/strategies";

const AzureServer = Server({
    server: "your-server.database.windows.net",
    options: { encrypt: true }
}).Auth(await ActiveDirectoryAccessToken({
    clientId: process.env.AZURE_CLIENT_ID!,
    clientSecret: process.env.AZURE_CLIENT_SECRET!,
    authority: "https://login.microsoftonline.com/your-tenant-id"
}));
```

### Creating Custom Authentication Strategies

Implement the `AuthStrategy` type: `(config: ServerConfig) => config`

```ts
import type { AuthStrategy } from "squilo/auth/strategies";

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
const VaultTokenAuth = async (): AuthStrategy => {
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

---

### Retrieve Operations

#### Simple Query

```ts
const [errors, users] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        // connection is ConnectionPoolWrapper with .query() method
        const result = await connection.query`
            SELECT Id, Name, Email, CreatedAt 
            FROM Users 
            WHERE Active = 1
            ORDER BY CreatedAt DESC
        `;
        return result.recordset;  // Returns array of rows
    })
    .Output(MergeOutputStrategy());
// Returns: [ExecutionError[], User[]]
```

#### Using Transactions (CTE, TVP, Complex Operations)

Wrap operations in a transaction for atomicity using the `await using` pattern. Transactions auto-rollback if `commit$()` is not called:

```ts
import { Table, type Request } from "mssql";

const [errors, summary] = await LocalServer
    .Connect("AnalyticsDB")
    .Retrieve(async (connection) => {
        // Create transaction with async disposable pattern
        await using transaction = await connection.transaction$();
        
        // Reuse a single request object for all operations
        const request = transaction.request();
        
        // Complex query with CTE
        const result1 = await request
            .query`
            WITH MonthlyActive AS (
                SELECT user_id, MAX(activity_date) as last_active
                FROM user_activities
                WHERE activity_date >= DATEADD(month, -1, GETDATE())
                GROUP BY user_id
            )
            SELECT COUNT(*) as TotalActive
            FROM MonthlyActive
            `;

        // Table-Valued Parameter example
        const tvp = new Table('UserList');
        tvp.columns.add('Id', 'Int');
        tvp.columns.add('Name', 'NVarChar(100)');
        tvp.rows.add([1, 'Alice'], [2, 'Bob']);

        const result2 = await request
            .input('Users', tvp)
            .query`SELECT * FROM ProcessUsers(@Users)`;

        // Additional operations can use the same request
        await request.query`
            INSERT INTO AuditLog (Action, Details)
            VALUES ('MonthlyActiveCalc', 'Processed ${result1.recordset[0]?.TotalActive} users')
        `;

        // Commit transaction - if we don't call this, it auto-rolls back on dispose
        await transaction.commit$();
        
        return {
            activeCount: result1.recordset[0]?.TotalActive,
            processed: result2.recordset
        };
    })
    .Output(MergeOutputStrategy());
```

### Data Transformation

#### Simple Transform: Do It Inline in Retrieve

For simple operations (formatting, calculated fields), transform directly in the Retrieve callback:

```ts
const [errors, users] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        const result = await connection.query`
            SELECT Id, Email, CreatedAt FROM Users WHERE Active = 1
        `;
        
        // Inline transformation - simple and efficient
        return result.recordset.map(user => ({
            ...user,
            Email: user.Email.toLowerCase().trim(),
            Initials: `${user.FirstName[0]}${user.LastName[0]}`,
            DaysActive: Math.floor((Date.now() - user.CreatedAt.getTime()) / (1000 * 60 * 60 * 24))
        }));
    })
    .Output(MergeOutputStrategy());
```

#### Complex Transform: Use the Transform Pipe

Use `Transform` when you need to perform **expensive operations that don't require a database connection**. The Transform pipe releases DB connections immediately, preventing connection pool exhaustion during lengthy operations.

**When to use Transform:**
✅ External API calls (geolocation, CRM lookup, payment verification)  
✅ File I/O operations (image processing, PDF generation, document parsing)  
✅ CPU-intensive calculations (encryption, compression, statistical analysis)  
✅ Operations that could block the connection pool  

**When NOT to use Transform (do in Retrieve instead):**
❌ Simple string formatting  
❌ Adding fields from existing data  
❌ Basic array operations (filter, map, reduce)  
❌ Quick calculations  

##### Example: External API Enrichment

```ts
const [errors, enrichedUsers] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        return await connection.query`
            SELECT Id, Email, CountryCode FROM Users WHERE Active = 1
        `;
    })
    .Transform(async (users) => {
        // DB connection is already released here!
        // Enrich with external API calls (can run in parallel)
        const enriched = await Promise.allSettled(
            users.map(async (user) => {
                try {
                    const geo = await fetch(`https://api.example.com/geo/${user.CountryCode}`)
                        .then(r => r.json());
                    const crm = await fetch(`https://crm.example.com/users/${user.Id}`)
                        .then(r => r.json());
                    return { ...user, ...geo, crmData: crm };
                } catch (error) {
                    return { ...user, enrichmentFailed: true, error: error.message };
                }
            })
        );
        
        return enriched.filter((result): result is PromiseFulfilledResult<any> => 
            result.status === 'fulfilled'
        ).map(r => r.value);
    })
    .Output(MergeOutputStrategy());
```

##### Example: File Processing

```ts
const [_, usersWithAvatars] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (connection) => {
        return await connection.query<{ Id: number; AvatarPath: string }>`
            SELECT Id, AvatarPath FROM Users WHERE HasAvatar = 1
        `;
    })
    .Transform(async (users) => {
        // Process images in parallel without holding DB connections
        const processed = await Promise.all(
            users.map(async (user) => {
                if (!user.AvatarPath) return user;
                
                try {
                    const imageBuffer = await Bun.file(user.AvatarPath).arrayBuffer();
                    const thumbnail = await generateThumbnail(imageBuffer, 64, 64);
                    const compressed = await compressImage(imageBuffer);
                    
                    return {
                        ...user,
                        Thumbnail: thumbnail,
                        CompressedSize: compressed.length,
                        OriginalSize: imageBuffer.byteLength
                    };
                } catch {
                    return { ...user, ProcessingFailed: true };
                }
            })
        );
        return processed;
    })
    .Output(MergeOutputStrategy());
```

---

### Execute Operations

Execute returns `Promise<ExecutionError<T>[]>` - an array of errors for any databases that failed:

#### Simple Update

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

#### Execute with Transaction$

For operations that need atomicity across multiple statements:

```ts
const errors = await LocalServer
    .Connect("OrderDB")
    .Execute(async (connection) => {
        // Create transaction with proper async disposal
        await using transaction = await connection.transaction$();
        
        // Reuse a single request object for all operations
        const request = transaction.request();
        
        // Multiple operations in single transaction
        await request
            .query`UPDATE Inventory SET Quantity = Quantity - 1 WHERE ProductId = 123`;
        
        await request
            .query`INSERT INTO OrderHistory (ProductId, Quantity) VALUES (123, 1)`;
        
        await request.query`
            INSERT INTO AuditLog (Action, Timestamp) 
            VALUES ('OrderCreated', GETDATE())
        `;
        
        // Explicit commit - if omitted, transaction auto-rolls back on dispose
        await transaction.commit$();
    });
```

#### Execute Across Multiple Databases

When executing across multiple databases, `Execute()` returns an array of errors for databases that failed. Successful executions are silent:

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
        
        // You can also do more operations per database
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
    
    // Optionally retry failed databases
    // const retryErrors = await retryFailedDatabases(errors);
}
```

---

### Output Strategies

The `Output()` method finalizes your pipeline and returns results. Available strategies:

#### 1. MergeOutputStrategy (In-Memory Merge)

Merges all results from multiple databases into a single array. Best for further processing in JavaScript/TypeScript.

```ts
import { MergeOutputStrategy } from "squilo/output/strategies";

const [errors, mergedData] = await LocalServer
    .Connect(["DB1", "DB2", "DB3"])
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users WHERE Active = 1`;
    })
    .Output(MergeOutputStrategy());

// Returns: [ExecutionError[], TData[]]
// errors: Array of { database: string, error: Error } for failed databases
// mergedData: Combined array of all successful results (flattened)
```

#### 2. JsonOutputStrategy (File Export)

Writes results to a JSON file. Automatically created with timestamp.

```ts
import { JsonOutputStrategy } from "squilo/output/strategies";

// Default: returns [errors, filename]
const [errors, filename] = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (conn) => {
        return await conn.query`SELECT * FROM Users`;
    })
    .Output(JsonOutputStrategy({
        includeEmpty: true,   // Include databases with no data (default: true)
        includeErrors: false  // Errors returned separately (default: false)
    }));

// With includeErrors=true: returns filename only (errors included in JSON)
const filenameWithErrors = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (conn) => query`SELECT * FROM Users`)
    .Output(JsonOutputStrategy({ includeEmpty: true, includeErrors: true }));
// Returns: string (filename)

console.log(`Data saved to: ${filename}`);
```

**Parameters:**
- `includeEmpty?: boolean` (default: `true`) - Include databases that returned no data
- `includeErrors?: boolean` (default: `false`) - Include error information in the JSON file

#### 3. XlsOutputStrategy (Excel Export)

Writes results to an Excel file (.xlsx) with options:

```ts
import { XlsOutputStrategy } from "squilo/output/strategies";

// Default: separate sheets per database
const [errors, filename] = await LocalServer
    .Connect(["DB1", "DB2", "DB3"])
    .Retrieve(async (conn, db) => {
        return await conn.query`SELECT * FROM ${db}.Users`;
    })
    .Output(XlsOutputStrategy({
        combineSheets: false,  // Separate sheets per database (default)
        includeEmpty: true,    // Include empty results (default: true)
        includeErrors: false   // Errors returned separately (default: false)
    }));

// Combined sheet: all data with Database column
const [errors, combinedFilename] = await LocalServer
    .Connect(["DB1", "DB2"])
    .Retrieve(async (conn, db) => {
        return await conn.query`SELECT * FROM Users`;
    })
    .Output(XlsOutputStrategy({ 
        combineSheets: true,    // All data in one sheet
        includeEmpty: true, 
        includeErrors: false 
    }));
```

**Parameters:**
- `combineSheets?: boolean` (default: `false`) - Combine all data into single sheet (adds Database column)
- `includeEmpty?: boolean` (default: `true`) - Include databases with no data
- `includeErrors?: boolean` (default: `false`) - Include errors in an "Errors" sheet

#### 4. ConsoleOutputStrategy (Debugging)

Logs results to console. Returns `void`. Great for debugging:

```ts
import { ConsoleOutputStrategy } from "squilo/output/strategies";

await LocalServer
    .Connect("TestDB")
    .Retrieve(async (conn) => {
        return await conn.query`SELECT TOP 5 * FROM Users`;
    })
    .Output(ConsoleOutputStrategy());
// Outputs to console, no return value
```

---

### Creating Custom Output Strategies

 Implement the `OutputStrategy<T, TReturn, TOutput>` type:

```ts
import type { OutputStrategy, ExecutionResult } from "squilo/output/strategies";

// OutputStrategy: (data: ReadableStream<ExecutionResult<T, TReturn>>) => Promise<TOutput>
// ExecutionResult = { database: T, data?: TReturn, error?: Error }

const CsvOutputStrategy = <T, TData>(): OutputStrategy<T, TData, string> => {
    return async (result): Promise<string> => {
        let csv = 'Database,Data\n';
        const errors: Array<{ database: T; error: Error }> = [];
        
        for await (const { database, data, error } of result) {
            if (error) {
                errors.push({ database, error });
                continue;
            }
            
            if (Array.isArray(data)) {
                data.forEach(row => {
                    const csvLine = Object.values(row)
                        .map(v => `"${String(v).replace(/"/g, '""')}"`)
                        .join(',');
                    csv += `${String(database)},${csvLine}\n`;
                });
            }
        }
        
        if (errors.length > 0) {
            console.error('CSV export had errors:', errors.length);
        }
        return csv;
    };
};

// Usage
const csvData = await LocalServer
    .Connect("UsersDB")
    .Retrieve(async (conn) => query`SELECT * FROM Users`)
    .Output(CsvOutputStrategy());
```

**Custom Strategy Ideas:**
- **Cloud storage upload**: Direct upload to S3/Azure Blob/Google Cloud
- **Message queue**: Publish to RabbitMQ, Kafka, Azure Service Bus
- **HTTP streaming**: Push to webhook or API endpoint
- **Database sync**: Copy to another database with transformations
- **Binary formats**: Protocol Buffers, MessagePack, Avro
- **Email reports**: Auto-generate and send email attachments
- **Chat notifications**: Send to Slack, Teams, Discord

---

#### Aggregating Results from Multiple Databases

When you use `MergeOutputStrategy()` with multiple databases, you get a **flattened array** with one entry per database. You can aggregate this data after retrieval:

**Example: Count aggregation across databases**

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
// results = [{activeCount: 10}, {activeCount: 15}, ...] - one entry per database

if (errors.length === 0) {
    // Aggregate: total sum
    const totalActiveUsers = results.reduce((sum, db) => sum + db.activeCount, 0);
    console.log(`Total active users: ${totalActiveUsers}`);
    
    // Per-database breakdown
    results.forEach((dbResult, idx) => {
        console.log(`  ${allDatabases[idx]}: ${dbResult.activeCount}`);
    });
}
```

**Example: Flatten and combine user data**

```ts
interface UserData {
    Id: number;
    Name: string;
    Email: string;
}

const [errors, allUsers] = await LocalServer
    .Connect(allDatabases)
    .Retrieve(async (connection, db) => {
        const result = await connection.query<UserData>`
            SELECT Id, Name, Email FROM Users WHERE Active = 1
        `;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());
// allUsers = flat array: [user1_db1, user2_db1, user1_db2, user2_db2, ...]

console.log(`Total users across all databases: ${allUsers.length}`);

// Group by database (if you added database identifier in query)
const byDatabase = allUsers.reduce((acc, user) => {
    // Assuming you included database name in SELECT
    const dbName = (user as any).Database; 
    acc[dbName] ??= [];
    acc[dbName].push(user);
    return acc;
}, {} as Record<string, UserData[]>);
```

**Aggregation in Custom Output Strategy**

For more complex aggregations (averages, statistical analysis, grouping), create a custom output strategy:

```ts
const AggregatingOutputStrategy = <T, TData>(): OutputStrategy<T, TData, { 
    totalCount: number; 
    averages: Record<string, number>; 
    errors: ExecutionError<T>[] 
}> => {
    return async (result): Promise<{
        totalCount: number;
        averages: Record<string, number>;
        errors: ExecutionError<T>[];
    }> => {
        let totalCount = 0;
        const sums: Record<string, number> = {};
        const counts: Record<string, number> = {};
        const errors: ExecutionError<T>[] = [];
        
        for await (const { database, data, error } of result) {
            if (error) {
                errors.push({ database, error });
                continue;
            }
            
            if (Array.isArray(data) && data.length > 0) {
                totalCount += data.length;
                
                // Example: calculate averages for numeric fields
                data.forEach(row => {
                    for (const [key, value] of Object.entries(row)) {
                        if (typeof value === 'number') {
                            sums[key] = (sums[key] || 0) + value;
                            counts[key] = (counts[key] || 0) + 1;
                        }
                    }
                });
            }
        }
        
        const averages: Record<string, number> = {};
        for (const key of Object.keys(sums)) {
            averages[key] = sums[key] / counts[key];
        }
        
        return { totalCount, averages, errors };
    };
};

// Usage
const aggregated = await LocalServer
    .Connect(allDatabases)
    .Retrieve(async (conn) => {
        return await conn.query<{ 
            salary: number; 
            age: number; 
            department: string 
        }>`SELECT * FROM Employees`;
    })
    .Output(AggregatingOutputStrategy());

console.log(`Total employees: ${aggregated.totalCount}`);
console.log(`Average salary: $${aggregated.averages.salary.toFixed(2)}`);
console.log(`Average age: ${aggregated.averages.age.toFixed(1)}`);
```

---

### The includeErrors Parameter

Some strategies support `includeErrors: true` which changes return type:

**Without includeErrors (default):**
```ts
const [errors, result] = await chain.Output(JsonOutputStrategy());
// Type: [ExecutionError[], string]  (errors separate, result is filename)
```

**With includeErrors: true**
```ts
const filename = await chain.Output(JsonOutputStrategy({ includeErrors: true }));
// Type: string  (errors embedded in JSON file, only filename returned)
```

**Why would you use includeErrors?**
- When you want a single return value (the file) and don't need programmatic error handling
- When errors should be logged/archived with the output file itself
- For simple batch scripts where any errors can be reviewed later

---

### Comparison: Transform vs Inline Processing

Understand when to use `Transform()` vs doing work in `Retrieve()`:

| Aspect | Inline in Retrieve | Transform Pipe |
|--------|-------------------|----------------|
| **DB Connection** | Held during processing | Released before processing |
| **Use Case** | Simple, fast operations | Expensive async operations |
| **Examples** | Formatting, calculations, mapping | API calls, file I/O, CPU-intensive |
| **Connection Pool** | Blocks until complete | Released immediately |

**Example: Both Approaches, Same Result**

```ts
// Approach 1: Inline (simple, efficient)
const [_, users1] = await LocalServer
    .Connect("DB")
    .Retrieve(async (conn) => {
        const result = await conn.query`SELECT * FROM Users`;
        return result.recordset.map(u => ({ ...u, Email: u.Email.toLowerCase() }));
    })
    .Output(MergeOutputStrategy());

// Approach 2: Transform (releases DB connection early)
const [_, users2] = await LocalServer
    .Connect("DB")
    .Retrieve(async (conn) => query`SELECT * FROM Users`)
    .Transform(users => users.map(u => ({ ...u, Email: u.Email.toLowerCase() })))
    .Output(MergeOutputStrategy());
// Same result, but Transform releases connection before mapping
```

**Choose inline for simple operations**: No need for extra abstraction.  
**Choose Transform for expensive ops**: API calls, file processing, etc.

---

## Configuration & Environment

### Configuration Options

Squilo uses mssql config but excludes authentication fields (managed by auth strategies):

```ts
interface ServerConfig {
    server: string;           // Server hostname (required)
    port?: number;            // Default: 1433
    database?: string;        // Default database
    options?: {
        encrypt?: boolean;
        trustServerCertificate?: boolean;
        enableArithAbort?: boolean;
        // ... all other mssql options
    };
    pool?: {
        max?: number;         // Default: 10
        min?: number;         // Default: 0
        idleTimeoutMillis?: number;
    };
    requestTimeout?: number;  // Default: 15000ms
    cancelTimeout?: number;   // Default: 5000ms
}
```

### Environment Variables

- `SAFE_GUARD` - Maximum number of database failures to tolerate before skipping all remaining databases (default: 1). When the failure count reaches this limit, subsequent database operations are skipped to save time/resources:
  ```bash
  SAFE_GUARD=5 bun run scripts/process-clients.ts
  ```
  This is useful for preventing wasted effort when there's a systemic issue affecting many databases. For example, if you're processing 100 databases and the first 5 fail, the remaining 95 will be skipped.

- `NODE_ENV` - Set to `test` to disable progress bars:
  ```bash
  NODE_ENV=test bun test
  ```

---

## Reference

### Source Code Structure

```
src/
├── pipes/
│   ├── auth/
│   │   ├── strategies/
│   │   │   ├── types.ts        # AuthStrategy definition
│   │   │   ├── userAndPassword.ts  # Simple SQL auth
│   │   │   └── msal.ts         # Azure AD authentication
│   │   └── index.ts            # Auth pipe implementation
│   ├── output/
│   │   ├── strategies/
│   │   │   ├── types.ts        # OutputStrategy definition
│   │   │   ├── json.ts         # JSON file output
│   │   │   ├── xls.ts          # Excel output
│   │   │   ├── console.ts      # Console logging
│   │   │   └── merge.ts        # In-memory merge
│   │   └── index.ts            # Output pipe implementation
│   ├── connect/                # Database connection handling
│   ├── retrieve/               # Data retrieval operations
│   ├── execute/                # Data modification operations
│   ├── transform/              # Post-processing pipeline
│   ├── server/                 # Server configuration
│   └── shared/runner/          # Connection execution engine
```

### Type Exports

Key types you may need for custom implementations:

```ts
// From squilo/auth/strategies
import type { AuthStrategy } from "squilo/auth/strategies";

// From squilo/output/strategies
import type { OutputStrategy, ExecutionResult, ExecutionError } from "squilo/output/strategies";

// From mssql (re-exported as SQL)
import { SQL, type ConnectionPool, type Transaction, type Request } from "squilo";
```

### Testing

Run the test suite to see real-world examples:

```bash
bun test
```

The `test/` directory contains comprehensive examples of:
- Multi-database orchestration patterns
- Error handling and recovery
- Transaction management
- Transform pipeline usage
- All output strategies

---

This project was created using `bun init` in Bun v1.2.20. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
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

## Usage Examples

### Server Configuration with Azure AD Authentication

```ts
// servers/production.ts
import { Server } from "squilo";
import { ActiveDirectoryAccessToken } from "squilo/auth/strategies";

export const Production = Server({
    server: "your-server.database.windows.net",
    options: {
        encrypt: true,
        trustedConnection: true,
        trustServerCertificate: false
    },
    requestTimeout: 300000
}).Auth(await ActiveDirectoryAccessToken({
    clientId: "your-client-id",
    clientSecret: "your-client-secret",
    authority: "https://login.microsoftonline.com/your-tenant-id"
}));
```

### Dynamic Database Connections

```ts
// databases/all-active.ts
import { Production } from "../servers/production";
import { Qas } from "../servers/qas";

// Connect to multiple databases dynamically from Production
export const AllActiveDatabases = Production
    .Connect({
        database: "ManagerDatabase",
        query: "SELECT [Database] FROM Client WHERE Active = 1"
    });

// Same pattern for QAS environment
export const AllActiveQasDatabases = Qas
    .Connect({
        database: "ManagerDatabase", 
        query: "SELECT [Database] FROM Client WHERE Active = 1"
    });

// Simple database connection
export const TestDatabase = Production.Connect("TestDatabase");
```

### Data Retrieval with Output Strategies

```ts
// scripts/user-report.ts
import { JsonOutputStrategy, XlsOutputStrategy } from "squilo/output/strategies";
import { Production } from "../servers/production";
import { AllActiveDatabases } from "../databases/all-active";

type UserData = {
    Id: number;
    Email: string;
    CreatedAt: Date;
}

// Retrieve data from multiple databases (uses Production by default)
await AllActiveDatabases
    .Retrieve(async (transaction, database) => {
        const result = await transaction
            .request()
            .query<UserData>`
                SELECT Id, Email, CreatedAt
                FROM Users
                WHERE Active = 1
                ORDER BY CreatedDate DESC
            `;
        return result.recordset;
    })
    .Output(JsonOutputStrategy());
```

### Execute Operations Across Multiple Databases

```ts
// scripts/update-campaign-status.ts
import { AllActiveDatabases } from "../databases/all-active";
import { Production } from "../servers/production";

await AllActiveDatabases
    .Execute(async (transaction, database) => {
        await transaction.request().query`
            UPDATE Campaigns 
            SET Status = 'Active'
            WHERE EndDate IS NULL AND StartDate <= GETDATE()
        `;
    })
    .then(() => process.exit(0));
```

### Complex Queries with TypeScript Types

```ts
// scripts/analytics-report.ts
import { JsonOutputStrategy } from "squilo/output/strategies";
import { Production } from "../servers/production";

type AnalyticsResult = {
    MaxConnectedStates: number;
}

await Production
    .Connect("AnalyticsDatabase")
    .Retrieve(async (transaction) => {
        const result = await transaction.request().query<AnalyticsResult>`
            -- Complex analytical query with CTEs and cursors
            WITH ActiveStates AS (
                SELECT DISTINCT State.Id
                FROM State
                INNER JOIN FlowState ON FlowState.StateId = State.Id
                WHERE Flow.EndDate IS NULL
            )
            SELECT MAX(ConnectedCount) As MaxConnectedStates
            FROM (
                SELECT COUNT(*) as ConnectedCount
                FROM ActiveStates
                GROUP BY StateGroup
            ) AS StateCounts;
        `;
        return result.recordset;
    })
    .Output(JsonOutputStrategy());
```

## Advanced Usage

### Authentication Strategies

Squilo supports multiple authentication methods:

```ts
// User and Password authentication
import { UserAndPassword } from "squilo/auth/strategies";
const auth = UserAndPassword("username", "password");

// Active Directory Access Token for Azure SQL
import { ActiveDirectoryAccessToken } from "squilo/auth/strategies";
const azureAuth = await ActiveDirectoryAccessToken({
  clientId: "your-client-id",
  clientSecret: "your-client-secret",
  authority: "https://login.microsoftonline.com/your-tenant-id"
});
```

### Input and Retrieval

```ts
// Retrieve data with typed results
type ConfigData = {
    Id: number;
    Setting: string;
    Value: string;
}

const results = await Production
    .Connect("ConfigDatabase")
    .Retrieve(async (transaction) => {
        const result = await transaction
            .request()
            .query<ConfigData>`
                SELECT Id, Setting, Value
                FROM Configuration
                ORDER BY CreatedDate
            `;
        return result.recordset;
    });

// Execute with database context
await AllActiveDatabases
    .Execute(async (transaction, database) => {
        console.log(`Processing database: ${database}`);
        await transaction.request().query`
            UPDATE Settings SET LastProcessed = GETDATE()
        `;
    });
```

### Output Strategies

Squilo provides multiple output formats:

```ts
// JSON output for data export
import { JsonOutputStrategy } from "squilo/output/strategies";
await AllActiveDatabases
    .Retrieve(async (transaction) => {
        const result = await transaction.request().query`
            SELECT Id, Name, Status FROM Reports
        `;
        return result.recordset;
    })
    .Output(JsonOutputStrategy());

// Excel output for reports
import { XlsOutputStrategy } from "squilo/output/strategies";
await Production
    .Connect("ReportsDatabase")
    .Retrieve(async (transaction) => {
        const result = await transaction.request().query`
            SELECT * FROM MonthlyStats WHERE Year = 2024
        `;
        return result.recordset;
    })
    .Output(XlsOutputStrategy());

// Console output for debugging
import { ConsoleOutputStrategy } from "squilo/output/strategies";
await Production
    .Connect("LogsDatabase")
    .Retrieve(async (transaction) => {
        const result = await transaction.request().query`
            SELECT TOP 10 * FROM ErrorLogs ORDER BY Timestamp DESC
        `;
        return result.recordset;
    })
    .Output(ConsoleOutputStrategy());

// Merge results from multiple databases
import { MergeOutputStrategy } from "squilo/output/strategies";
await AllActiveDatabases
    .Retrieve(async (transaction, database) => {
        const result = await transaction.request().query`
            SELECT '${database}' as DatabaseName, COUNT(*) as UserCount
            FROM Users WHERE Active = 1
        `;
        return result.recordset;
    })
    .Output(MergeOutputStrategy());
```

### Connection Management

Properly manage connections in production scripts:

```ts
// Always close connections in production scripts
import { Production } from "../servers/production";

await Production
    .Connect("ProductionDatabase")
    .Retrieve(async (transaction) => {
        const result = await transaction.request().query`
            SELECT * FROM ImportantData
        `;
        return result.recordset;
    })
    .Output(JsonOutputStrategy());

// Close the connection and exit
await Production.Close();
process.exit(0);
```

### Script Organization

Organize your scripts in a clear structure:

```
project/
├── servers/
│   ├── production.ts    # Production server config
│   └── qas.ts          # QAS/staging server config
├── databases/
│   ├── all-active.ts   # Dynamic database connections
│   └── test.ts         # Test database connections
└── scripts/
    ├── reports/        # Report generation scripts
    ├── maintenance/    # Database maintenance scripts
    └── analytics/      # Analytics and data processing
```

### Running Scripts

```bash
# Run individual scripts
bun run scripts/reports/user-activity.ts

# Run with specific environment
NODE_ENV=production bun run scripts/maintenance/cleanup.ts
```

## Reference

See the [test suite](./test/) for more advanced usage and orchestration patterns.

---

This project was created using `bun init` in bun v1.2.20. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

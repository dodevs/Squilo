---
name: create-custom-output-strategy
description: >
  Implement custom OutputStrategy for bespoke result formatting (CSV, PDF,
  webhook push, database write-back). Iterate ReadableStream<ExecutionResult>
  with for-await. Check item.error vs item.data per chunk. Return custom
  type. Chain after Retrieve() or Transform().
type: core
library: squilo
library_version: "0.7.0-beta.1"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/types.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/strategies/merge.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/output/index.ts"
---

# Squilo — Create Custom Output Strategy

Implement a custom `OutputStrategy` when built-in strategies (`MergeOutputStrategy`, `JsonOutputStrategy`, `ConsoleOutputStrategy`, `XlsOutputStrategy`) don't meet your formatting or delivery needs. `OutputStrategy` is a function that consumes a `ReadableStream<ExecutionResult>` and returns any type.

## Setup

Minimum custom output strategy (CSV):

```ts
import { Server, UserAndPassword } from "squilo";
import type { OutputStrategy, ExecutionResult, ExecutionError } from "squilo";

const CsvOutputStrategy = <T, TData>(): OutputStrategy<
	T,
	TData,
	[ExecutionError<T>[], string]
> => async (result) => {
	const errors: ExecutionError<T>[] = [];
	const rows: string[] = [];
	let first = true;

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
			continue;
		}
		if (Array.isArray(item.data)) {
			for (const row of item.data) {
				if (!first) rows.push(",\n");
				rows.push(JSON.stringify(row));
				first = false;
			}
		} else if (item.data) {
			if (!first) rows.push(",\n");
			rows.push(JSON.stringify(item.data));
			first = false;
		}
	}

	const csv = rows.join("");
	const filename = `output-${Date.now()}.csv`;
	await Bun.write(filename, csv);
	return [errors, filename];
};

const [errors, filename] = await Server({
	server: "localhost",
	port: 1433,
	options: { encrypt: false }
}).Auth(UserAndPassword("sa", "password"))
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT Id, Name FROM Users`;
		return result.recordset;
	})
	.Output(CsvOutputStrategy());

console.log(`CSV written to ${filename}`);
process.exit(0);
```

## Core Patterns

### Webhook push output

```ts
import { Server, UserAndPassword } from "squilo";
import type { OutputStrategy, ExecutionResult, ExecutionError } from "squilo";

const WebhookOutputStrategy = <T, TData>(
	webhookUrl: string
): OutputStrategy<T, TData, [ExecutionError<T>[], number]> => async (result) => {
	const errors: ExecutionError<T>[] = [];
	let sentCount = 0;

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
			continue;
		}

		const response = await fetch(webhookUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				database: item.database,
				data: item.data
			})
		});

		if (!response.ok) {
			errors.push({
				database: item.database,
				error: new Error(`Webhook failed: ${response.status}`)
			});
		} else {
			sentCount++;
		}
	}

	return [errors, sentCount];
};

const [errors, sent] = await Server({ ... }).Auth(...)
	.Connect(["DB1", "DB2"])
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(WebhookOutputStrategy("https://hooks.example.com/data"));

console.log(`Sent ${sent} payloads`);
process.exit(0);
```

### Database write-back output

```ts
import { Server, UserAndPassword, MergeOutputStrategy } from "squilo";
import type { OutputStrategy, ExecutionResult, ExecutionError } from "squilo";

const WriteBackOutputStrategy = <T, TData>(
	targetConn: import("mssql").ConnectionPool
): OutputStrategy<T, TData, ExecutionError<T>[]> => async (result) => {
	const errors: ExecutionError<T>[] = [];

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
			continue;
		}

		try {
			if (Array.isArray(item.data)) {
				for (const row of item.data) {
					await targetConn.request()
						.input("SourceDB", item.database)
						.input("Data", JSON.stringify(row))
						.query`INSERT INTO AuditLog (SourceDB, Data) VALUES (@SourceDB, @Data)`;
				}
			}
		} catch (err) {
			errors.push({ database: item.database, error: err as Error });
		}
	}

	return errors;
};
```

### Return type without errors (filename only)

```ts
import { Server, UserAndPassword } from "squilo";
import type { OutputStrategy, ExecutionError } from "squilo";

const JsonWithErrorsInFile = <T, TData>(): OutputStrategy<
	T,
	TData,
	string
> => async (result) => {
	const errors: ExecutionError<T>[] = [];
	const data: any[] = [];

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
		} else if (item.data) {
			if (Array.isArray(item.data)) {
				data.push(...item.data);
			} else {
				data.push(item.data);
			}
		}
	}

	const filename = `output-${Date.now()}.json`;
	await Bun.write(filename, JSON.stringify({ data, errors }, null, 2));
	return filename; // Single string — errors embedded in file
};

const filename = await Server({ ... }).Auth(...)
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(JsonWithErrorsInFile());

// Errors are inside the JSON file, not returned separately
console.log(`Output written to ${filename}`);
process.exit(0);
```

## Common Mistakes

### CRITICAL Not handling both item.error and item.data

Wrong:

```ts
import type { OutputStrategy } from "squilo";

const BadStrategy = (): OutputStrategy<string, any, void> => async (result) => {
	const data: any[] = [];

	for await (const item of result) {
		// Only handles data — errors cause undefined entries in array
		data.push(item.data);
	}

	console.log(data);
};
```

Correct:

```ts
import type { OutputStrategy, ExecutionError } from "squilo";

const GoodStrategy = <T>(): OutputStrategy<T, any, void> => async (result) => {
	const errors: ExecutionError<T>[] = [];
	const data: any[] = [];

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
			continue;
		}
		if (item.data !== undefined) {
			data.push(item.data);
		}
	}

	console.log(`${data.length} results, ${errors.length} errors`);
};
```

Each `ExecutionResult` chunk has either `item.error` or `item.data` (or neither for empty results). Always check `item.error` first and skip error items from data collection.

Source: packages/squilo/src/pipes/shared/runner/types.ts

### HIGH Not awaiting async operations inside for-await loop

Wrong:

```ts
import type { OutputStrategy } from "squilo";

const BadStrategy = (): OutputStrategy<string, any, void> => async (result) => {
	for await (const item of result) {
		if (item.error) continue;

		// Fire-and-forget — script exits before writes complete
		Bun.write(`./output-${item.database}.json`, JSON.stringify(item.data));
	}
};
```

Correct:

```ts
import type { OutputStrategy, ExecutionError } from "squilo";

const GoodStrategy = <T>(): OutputStrategy<T, any, void> => async (result) => {
	const errors: ExecutionError<T>[] = [];

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
			continue;
		}

		// Await each write to ensure completion before next iteration
		await Bun.write(`./output-${item.database}.json`, JSON.stringify(item.data));
	}
};
```

The `for-await` loop iterates the stream, but async operations inside must also be awaited. Fire-and-forget writes may not complete before the script exits.

Source: packages/squilo/src/pipes/output/strategies/types.ts

### MEDIUM Returning void when errors should be captured

Wrong:

```ts
import type { OutputStrategy } from "squilo";

const VoidStrategy = (): OutputStrategy<string, any, void> => async (result) => {
	for await (const item of result) {
		if (item.error) {
			console.error(`Error in ${item.database}:`, item.error.message);
			// Error logged but not returned — caller can't handle it
		}
	}
};

// Caller has no way to know if errors occurred
await Server({ ... }).Auth(...)
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(VoidStrategy());
```

Correct:

```ts
import type { OutputStrategy, ExecutionError } from "squilo";

const ErrorCapturingStrategy = <T>(): OutputStrategy<
	T,
	any,
	[ExecutionError<T>[], number]
> => async (result) => {
	const errors: ExecutionError<T>[] = [];
	let successCount = 0;

	for await (const item of result) {
		if (item.error) {
			errors.push({ database: item.database, error: item.error });
			continue;
		}
		successCount++;
	}

	return [errors, successCount];
};

const [errors, count] = await Server({ ... }).Auth(...)
	.Connect("MyDB")
	.Retrieve(async (conn) => {
		const result = await conn.query`SELECT * FROM Users`;
		return result.recordset;
	})
	.Output(ErrorCapturingStrategy());

if (errors.length > 0) {
	console.error(`${errors.length} errors`);
	process.exit(1);
}
```

Custom strategies should return errors alongside their primary output. The caller needs to know if any databases failed. Return a tuple `[errors, result]` pattern.

Source: packages/squilo/src/pipes/output/strategies/merge.ts
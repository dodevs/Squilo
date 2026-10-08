import {
	type AuthStrategy,
	type ExecutionError,
	MergeOutputStrategy,
	type OutputStrategy,
	Server,
	type ServerConfig,
	UserAndPassword,
} from "squilo";
import { Classify, type Level } from "./classify";
import type { Auth, Config, TargetEntry } from "./config";

export type Database = { Database: string; [column: string]: unknown };

export type Sql = (
	strings: TemplateStringsArray,
	...values: unknown[]
) => Promise<Record<string, unknown>[]>;

export type ReadFn<TReturn> = (
	sql: Sql,
	database: Database,
) => Promise<TReturn>;

export type TargetOptions = { databases?: string[] };

export type TransformPipeline<TData> = {
	Output<TOutput>(
		strategy: OutputStrategy<string, TData, TOutput>,
	): Promise<TOutput>;
};

export type RetrievePipeline<TData> = TransformPipeline<TData> & {
	Transform<TOutput>(
		fn: (data: TData) => TOutput | Promise<TOutput>,
	): TransformPipeline<TOutput>;
};

export type TargetPipeline = {
	Retrieve<TReturn>(fn: ReadFn<TReturn>): RetrievePipeline<TReturn>;
	Execute(
		fn: (sql: Sql, database: Database) => Promise<void>,
	): Promise<ExecutionError<string>[]>;
};

/**
 * The writes of an Execute (values inlined, for people to read) and, per database,
 * the rows each write changed or why it failed.
 */
export type Execution = {
	target: string;
	statements: string[];
	databases: Record<string, number[] | { error: string }>;
};

export type WriteMode = { kind: "plan" } | { kind: "apply"; plan: Execution[] };

export type Targets = {
	target: (name: string, options?: TargetOptions) => TargetPipeline;
	executions: Execution[];
};

type Transaction = {
	request(): {
		query(
			strings: TemplateStringsArray,
			...values: unknown[]
		): Promise<{
			recordset: Record<string, unknown>[];
			rowsAffected: number[];
		}>;
	};
};

const strategy = async (auth: Auth): Promise<AuthStrategy> => {
	if (auth.kind === "msal") {
		const { ActiveDirectoryAccessToken } = await import(
			"@squilo/msal-auth-strategy"
		);
		return ActiveDirectoryAccessToken({
			clientId: auth.clientId,
			authority: auth.authority,
		});
	}

	const password =
		auth.password ??
		(auth.passwordEnv ? process.env[auth.passwordEnv] : undefined);
	if (password === undefined) {
		throw new Error(
			`No password for user "${auth.user}": set password or passwordEnv`,
		);
	}
	return UserAndPassword(auth.user, password);
};

const targetOf = (config: Config, name: string): TargetEntry => {
	const target = config.targets[name];
	if (!target) {
		throw new Error(`Unknown target "${name}"`);
	}
	return target;
};

const authenticate = async (config: Config, target: TargetEntry) => {
	const { auth, ...server } = config.servers[target.server]!;
	return Server(server as ServerConfig).Auth(await strategy(auth));
};

export const Databases =
	(config: Config) =>
	async (name: string): Promise<Database[]> => {
		const target = targetOf(config, name);

		if (target.databases) {
			return target.databases.map((Database) => ({ Database }));
		}

		const { database, query } = target.discover!;
		const server = await authenticate(config, target);
		const [errors, rows] = await server
			.Connect(database)
			.Retrieve(async (conn) => (await conn.query<Database>(query)).recordset)
			.Output(MergeOutputStrategy());

		if (errors[0]) {
			throw AsError(errors[0].error);
		}
		return rows;
	};

/**
 * Squilo reports errors as plain objects, which an MCP tool error would print as [object Object].
 */
export const AsError = (value: unknown): Error => {
	if (value instanceof Error) {
		return value;
	}
	const { name, message } = (value ?? {}) as {
		name?: unknown;
		message?: unknown;
	};
	return new Error(
		typeof message === "string"
			? `${name ?? "Error"}: ${message}`
			: String(value),
	);
};

const connect = async (
	config: Config,
	name: string,
	databases: string[] | undefined,
	signal: AbortSignal | undefined,
) => {
	const target = targetOf(config, name);
	const all = await Databases(config)(name);

	const missing =
		databases?.filter(
			(database) => !all.some((row) => row.Database === database),
		) ?? [];
	if (missing.length > 0) {
		throw new Error(`Not in target "${name}": ${missing.join(", ")}`);
	}

	const selected = databases
		? all.filter((row) => databases.includes(row.Database))
		: all;
	const rows = new Map(selected.map((row) => [row.Database, row]));
	const server = await authenticate(config, target);

	return {
		rows,
		chain: server.Connect([...rows.keys()], {
			concurrent: target.concurrent,
			timeout: target.timeout,
			signal,
		}),
	};
};

const literal = (value: unknown) => {
	if (value === null || value === undefined) return "NULL";
	if (value instanceof Date) return `'${value.toISOString()}'`;
	return typeof value === "string"
		? `N'${value.replaceAll("'", "''")}'`
		: String(value);
};

const statement = (strings: TemplateStringsArray, values: unknown[]) =>
	strings
		.slice(1)
		.reduce(
			(text, part, index) => text + literal(values[index]) + part,
			strings[0]!,
		)
		.replace(/\s+/g, " ")
		.trim();

const facade = (
	transaction: Transaction,
	allowed: Level[],
	written?: (rows: number, statement: string) => void,
): Sql => {
	// A transaction runs one request at a time.
	let previous: Promise<unknown> = Promise.resolve();

	return async (strings, ...values) => {
		const { level, keyword } = Classify(strings.join(" "));
		if (level !== "read" && !allowed.includes(level)) {
			throw new Error(
				written === undefined
					? `Read-only query: "${keyword}" is not allowed`
					: `"${keyword}" (${level.toUpperCase()}) is not allowed on this target`,
			);
		}

		const current = previous.then(() =>
			transaction.request().query(strings, ...values),
		);
		previous = current.catch(() => {});
		const { recordset, rowsAffected } = await current;

		if (level !== "read") {
			written?.(
				rowsAffected.reduce((total, rows) => total + rows, 0),
				statement(strings, values),
			);
		}
		return recordset;
	};
};

const same = (a: number[], b: number[]) =>
	a.length === b.length && a.every((rows, index) => rows === b[index]);

export const Targets = (
	config: Config,
	{ signal, write }: { signal?: AbortSignal; write?: WriteMode } = {},
): Targets => {
	const executions: Execution[] = [];

	const target = (
		name: string,
		{ databases }: TargetOptions = {},
	): TargetPipeline => ({
		Retrieve: <TReturn>(fn: ReadFn<TReturn>): RetrievePipeline<TReturn> => {
			const retrieve = async () => {
				const { rows, chain } = await connect(config, name, databases, signal);

				return chain.Retrieve(async (conn, database) => {
					await using transaction = await conn.transaction$();
					return await fn(facade(transaction, []), rows.get(database)!);
				});
			};

			return {
				Transform: (transform) => ({
					Output: async (output) =>
						(await retrieve()).Transform(transform).Output(output),
				}),
				Output: async (output) => (await retrieve()).Output(output),
			};
		},

		Execute: async (fn) => {
			if (!write) {
				throw new Error("Execute writes: use the plan tool, then apply");
			}
			const allowed = targetOf(config, name).allow ?? [];
			if (allowed.length === 0) {
				throw new Error(
					`Target "${name}" is read only: its config has no allow`,
				);
			}

			const execution: Execution = {
				target: name,
				statements: [],
				databases: {},
			};
			const planned =
				write.kind === "apply" ? write.plan[executions.length] : execution;
			executions.push(execution);
			if (planned?.target !== name) {
				throw new Error("The script no longer matches the plan");
			}

			const { rows, chain } = await connect(config, name, databases, signal);
			const errors = await chain.Execute(async (conn, database) => {
				const expected = planned.databases[database];
				if (write.kind === "apply" && !Array.isArray(expected)) {
					throw new Error(expected ? "Failed in the plan" : "Not in the plan");
				}

				await using transaction = await conn.transaction$();
				const written: number[] = [];
				const sql = facade(transaction, allowed, (count, text) => {
					written.push(count);
					if (!execution.statements.includes(text)) {
						execution.statements.push(text);
					}
				});
				await fn(sql, rows.get(database)!);
				execution.databases[database] = written;

				if (write.kind === "apply") {
					if (!same(written, expected as number[])) {
						throw new Error(
							`Changed since the plan: planned [${expected}] rows, found [${written}]`,
						);
					}
					await transaction.commit$();
				}
			});

			for (const { database, error } of errors) {
				execution.databases[database] = {
					error: `${error.name}: ${error.message}`,
				};
			}
			for (const database of rows.keys()) {
				execution.databases[database] ??= {
					error: "Skipped after an earlier failure",
				};
			}
			return errors;
		},
	});

	return { target, executions };
};

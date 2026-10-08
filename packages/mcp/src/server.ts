import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { XlsOutputStrategy } from "@squilo/xls-output-strategy";
import { JsonOutputStrategy, MergeOutputStrategy } from "squilo";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import {
	ConfigShape,
	KeepPasswords,
	LoadConfig,
	MaskPasswords,
	SaveConfig,
} from "./config";
import { ListInputs, ReadInput } from "./inputs";
import { AsError, Databases, type Execution, Targets } from "./target";

export type ServerOptions = {
	configPath: string;
	resultsDir: string;
	inputsDir: string;
	maxOutput?: number;
};

const SCOPE = [
	"target",
	"input",
	"inputs",
	"MergeOutputStrategy",
	"JsonOutputStrategy",
	"XlsOutputStrategy",
];

const AsyncFunction = (async () => {}).constructor as new (
	...args: string[]
) => (...scope: unknown[]) => Promise<unknown>;

const text = (value: string) => ({
	content: [{ type: "text" as const, text: value }],
});

const INSTRUCTIONS = `Squilo reads SQL Server databases grouped in targets, and writes to them through plan and apply when the client can ask the user to confirm.
1. targets lists the targets. With none, set them up with the user through save_config.
2. databases lists the databases of a target. Before querying many databases, learn the schema with run on a single one (INFORMATION_SCHEMA).
3. run reads with a JavaScript script of Squilo pipelines. Aggregate in the script and return only what answers the question.
4. To write, plan a script that uses Execute, show the user the rows per database, then apply: the user confirms in a dialog.`;

const RUN_DESCRIPTION = `Runs a JavaScript script that reads SQL Server databases through Squilo pipelines, and returns what the script returns. The code parameter describes the API.
Read only: a batch with INSERT, UPDATE, DELETE, MERGE, DDL, EXEC, transaction statements or SELECT INTO a table is rejected, and each database runs inside a transaction that is rolled back. To write, use plan (when available).
Return only what answers the question, aggregated in the script: long output is truncated.`;

const PLAN_DESCRIPTION = `Dry-runs a script whose pipelines may also write with Execute (the code parameter describes the API), on targets whose config allows it.
Nothing is kept: each database's transaction is rolled back after recording how many rows each write changed. Returns a planId, what the script returned, and the rows each write changed per database (writes).
Show the user the summary, then call apply with the planId.`;

const EXECUTE_REFERENCE = `- \`target(name).Execute(async (sql, database) => { await sql\`UPDATE ...\` })\` writes on every database of the target in parallel and resolves to \`[{ database, error }]\`. Its \`sql\` runs the writes the target's allow covers: dml (INSERT, UPDATE, DELETE, MERGE) and ddl (CREATE, ALTER, DROP, TRUNCATE, EXEC, SELECT INTO). Transaction statements are never allowed.
`;

const codeReference = (
	inputsDir: string,
	resultsDir: string,
	execute = "",
) => `Body of an async JavaScript function: plain JavaScript, no TypeScript syntax, no imports. In scope:
- \`target(name, { databases }?)\` starts a pipeline on the databases of a target (all of them, or the listed ones):
  \`target(name).Retrieve(async (sql, database) => ...)\`, then optionally \`.Transform((data) => ...)\`, then \`.Output(strategy)\`.
  - \`Retrieve\` runs once per database, in parallel. \`sql\` is a tagged template that runs one T-SQL batch and resolves to the rows of its first result set; interpolated values are sent as parameters, so they cannot be table or column names. It only reads. \`database\` is \`{ Database, ...other columns of the target's discovery query }\`.
  - \`Transform\` runs on each database's data.
  - \`Output\` consumes the results of every database and resolves to what the strategy returns:
    - \`MergeOutputStrategy()\`: \`[errors, rows]\`, every database's rows in one array (a non-array result is one row);
    - \`JsonOutputStrategy()\`: \`[errors, path]\` of a JSON file with every database's result;
    - \`XlsOutputStrategy(combineSheets = false)\`: \`[errors, path]\` of an Excel file, one sheet per database or all rows in one sheet;
    - your own \`async (results) => ...\`, reading \`{ database, data, error }\` items with \`for await\`.
  - \`errors\` is \`[{ database, error }]\`: a failing database does not fail the pipeline.
${execute}- \`inputs()\` lists the files the user put in ${inputsDir}; \`input(name)\` reads one: .json parsed, .csv as rows, .xlsx as \`{ [sheet]: rows }\`, anything else as text.

Combine pipelines and inputs in JavaScript (await several targets, join, group, rank). Files are written to ${resultsDir}: tell the user the path.
To learn a schema, query INFORMATION_SCHEMA on a single database (\`{ databases: ["Name"] }\`) before querying all of them.

Example:
const [errors, rows] = await target("tenants")
  .Retrieve(async (sql, database) => {
    const [row] = await sql\`SELECT COUNT(*) AS Users FROM Users WHERE Active = \${1}\`;
    return { tenant: database.Database, users: row.Users };
  })
  .Output(MergeOutputStrategy());
return { errors, top: rows.sort((a, b) => b.users - a.users).slice(0, 10) };`;

const APPLY_DESCRIPTION = `Commits a plan once the user confirms it in a dialog that shows the script and the rows per database.
The plan's script runs again, and each database commits only if its writes change the same number of rows as in the plan; the others roll back and are reported. Databases that failed in the plan are not changed. Each database commits on its own: there is no commit across databases.`;

const sum = (rows: number[]) => rows.reduce((total, count) => total + count, 0);

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

// Claude Code shows the first lines of a confirmation only: they must say what will change.
const headline = (executions: Execution[]) => {
	const changed = new Set<string>();
	let rows = 0;
	for (const { target, databases } of executions) {
		for (const [database, written] of Object.entries(databases)) {
			if (Array.isArray(written)) {
				changed.add(`${target}/${database}`);
				rows += sum(written);
			}
		}
	}
	const targets = [...new Set(executions.map(({ target }) => target))];
	const [first = "No writes", ...others] = executions.flatMap(
		({ statements }) => statements,
	);

	return [
		`Commit ${count(rows, "row")} in ${count(changed.size, "database")} of ${targets.join(", ")}?`,
		`${first.length > 160 ? `${first.slice(0, 160)}...` : first}${others.length > 0 ? ` (+${others.length} more)` : ""}`,
	];
};

const report = (planId: string, code: string, executions: Execution[]) => {
	const sections = executions.map(
		({ target, statements, databases }, index) => {
			const writes = statements.map((statement) => `    ${statement}`);
			const rows = Object.entries(databases).map(
				([database, written]) =>
					`    ${database}: ${Array.isArray(written) ? count(sum(written), "row") : `not changed (${written.error})`}`,
			);
			return `${index + 1}. ${target}\n  Writes:\n${writes.join("\n")}\n  Databases:\n${rows.join("\n")}`;
		},
	);
	return `Plan ${planId}\n\n${sections.join("\n\n")}\n\nScript:\n${code}\n`;
};

const SAVE_CONFIG_DESCRIPTION = `Replaces the Squilo config (servers and targets) and applies it right away. The previous file is kept as a .bak.

Build the config with the user: for each server ask the host and how to sign in, for each target ask which databases (a fixed list, or a discovery query in a management database that returns a [Database] column).
Sign-in:
- Azure SQL with Entra ID: auth { kind: "msal", clientId, authority }. No secret: the browser opens on first use.
- SQL login: auth { kind: "userAndPassword", user, passwordEnv } with the name of an environment variable the user sets (then restarts the app). A password typed in the chat stays in the conversation: use password only for local development servers, and say so.
Start from the config tool's output to change an existing config: "********" keeps the saved password.
After saving, call databases on each new target to test the connection.`;

export const SquiloServer = ({
	configPath,
	resultsDir,
	inputsDir,
	maxOutput = 50_000,
}: ServerOptions): McpServer => {
	const server = new McpServer(
		{ name: "squilo", version: pkg.version },
		{ instructions: INSTRUCTIONS },
	);
	const config = () => LoadConfig(configPath);
	const plans = new Map<
		string,
		{ code: string; executions: Execution[]; file: string }
	>();

	const script = (code: string, target: Targets["target"]) =>
		new AsyncFunction(...SCOPE, code)(
			target,
			ReadInput(inputsDir),
			ListInputs(inputsDir),
			MergeOutputStrategy,
			JsonOutputStrategy,
			XlsOutputStrategy,
		).catch((error) => {
			throw AsError(error);
		});

	const output = async (result: unknown) => {
		const json =
			JSON.stringify(
				result,
				(key, value) => (key === "stack" ? undefined : value),
				1,
			) ?? "undefined";
		if (json.length <= maxOutput) {
			return text(json);
		}

		await mkdir(resultsDir, { recursive: true });
		const file = join(
			resultsDir,
			`${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
		);
		await writeFile(file, json);
		return text(
			`${json.slice(0, maxOutput)}\n\n[Truncated: ${json.length} characters. Full result saved to ${file}. Return less data from the script.]`,
		);
	};

	server.registerTool(
		"targets",
		{
			description:
				"Lists the targets (groups of SQL Server databases) that `run` can read.",
			annotations: { readOnlyHint: true },
		},
		async () => {
			const { servers, targets } = await config();
			if (Object.keys(targets).length === 0) {
				return text(
					`No targets in ${configPath} yet: set them up with the user through save_config.`,
				);
			}
			return output(
				Object.entries(targets).map(([name, target]) => ({
					name,
					description: target.description,
					server: servers[target.server]?.server,
					databases:
						target.databases ?? `discovered in ${target.discover?.database}`,
				})),
			);
		},
	);

	server.registerTool(
		"databases",
		{
			description:
				"Lists the databases of a target, with the columns its discovery query returns.",
			inputSchema: { target: z.string() },
			annotations: { readOnlyHint: true },
		},
		async ({ target }) => output(await Databases(await config())(target)),
	);

	server.registerTool(
		"run",
		{
			description: RUN_DESCRIPTION,
			inputSchema: {
				code: z.string().describe(codeReference(inputsDir, resultsDir)),
			},
			annotations: { readOnlyHint: true },
		},
		async ({ code }, extra) =>
			output(
				await script(
					code,
					Targets(await config(), { signal: extra.signal }).target,
				),
			),
	);

	server.registerTool(
		"config",
		{
			description: `Shows the Squilo config (${configPath}), passwords masked.`,
			annotations: { readOnlyHint: true },
		},
		async () => output(MaskPasswords(await config())),
	);

	server.registerTool(
		"save_config",
		{
			description: SAVE_CONFIG_DESCRIPTION,
			inputSchema: { config: ConfigShape },
			annotations: { readOnlyHint: false, destructiveHint: true },
		},
		async ({ config: next }) => {
			const previous = await config().catch(() => ({
				servers: {},
				targets: {},
			}));
			await SaveConfig(configPath, KeepPasswords(next, previous));
			return text(
				`Saved ${configPath}. Targets: ${Object.keys(next.targets).join(", ") || "none"}.`,
			);
		},
	);

	// Writes need a confirmation the model cannot answer: a dialog the client shows to the user.
	server.server.oninitialized = () => {
		if (!server.server.getClientCapabilities()?.elicitation?.form) {
			return;
		}

		server.registerTool(
			"plan",
			{
				description: PLAN_DESCRIPTION,
				inputSchema: {
					code: z
						.string()
						.describe(codeReference(inputsDir, resultsDir, EXECUTE_REFERENCE)),
				},
				annotations: { readOnlyHint: true },
			},
			async ({ code }, extra) => {
				const { target, executions } = Targets(await config(), {
					signal: extra.signal,
					write: { kind: "plan" },
				});
				const result = await script(code, target);
				if (executions.length === 0) {
					return output({
						result,
						writes: "The script ran no Execute: nothing to apply.",
					});
				}

				const planId = randomUUID();
				const file = join(resultsDir, `plan-${planId}.txt`);
				await mkdir(resultsDir, { recursive: true });
				await writeFile(file, report(planId, code, executions));
				plans.set(planId, { code, executions, file });
				return output({ planId, file, result, writes: executions });
			},
		);

		server.registerTool(
			"apply",
			{
				description: APPLY_DESCRIPTION,
				inputSchema: { planId: z.string() },
				annotations: { readOnlyHint: false, destructiveHint: true },
			},
			async ({ planId }, extra) => {
				const plan = plans.get(planId);
				if (!plan) {
					throw new Error(`Unknown plan "${planId}": run plan again`);
				}

				const { action, content } = await server.server.elicitInput(
					{
						mode: "form",
						message: [
							...headline(plan.executions),
							`Full plan: ${plan.file}`,
							"",
							report(planId, plan.code, plan.executions),
						].join("\n"),
						requestedSchema: {
							type: "object",
							properties: {
								confirm: {
									type: "boolean",
									title: "Commit these changes",
									default: false,
								},
							},
							required: ["confirm"],
						},
					},
					{ timeout: 600_000 },
				);
				if (action !== "accept" || content?.confirm !== true) {
					return text("Not applied: the user did not confirm.");
				}

				plans.delete(planId);
				const { target, executions } = Targets(await config(), {
					signal: extra.signal,
					write: { kind: "apply", plan: plan.executions },
				});
				try {
					return output({
						result: await script(plan.code, target),
						writes: executions,
					});
				} catch (error) {
					return {
						...(await output({ error: String(error), writes: executions })),
						isError: true,
					};
				}
			},
		);
	};

	return server;
};

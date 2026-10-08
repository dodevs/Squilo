import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import * as XLSX from "xlsx";
import {
	SQL_PASSWORD,
	UseSqlServer,
} from "../../squilo/test/container/container";
import {
	CLIENTS_MANAGER_DATABASE,
	DATABASES,
	SetupClientManager,
	SetupDatabases,
} from "../../squilo/test/container/setup/databases";
import { SquiloServer } from "../src/server";

describe("SquiloServer", () => {
	const sql = UseSqlServer(async (container) => {
		await SetupDatabases(container);
		await SetupClientManager(container);
	});

	const client = new Client({ name: "test", version: "0.0.0" });
	const script = process.argv[1];
	let resultsDir: string;
	let configPath: string;
	let emptyTargets: { isError: boolean; text: string };
	let saved: { isError: boolean; text: string };

	const call = async (name: string, args: Record<string, unknown> = {}) => {
		const result = await client.callTool({ name, arguments: args });
		const [content] = result.content as { text: string }[];
		return { isError: result.isError === true, text: content!.text };
	};

	const run = async (code: string) => {
		const result = await call("run", { code });
		expect(result.isError).toBe(false);
		return JSON.parse(result.text);
	};

	beforeAll(async () => {
		const home = await mkdtemp(join(tmpdir(), "squilo-"));
		resultsDir = join(home, "results");
		await mkdir(join(home, "inputs"));
		await mkdir(resultsDir);
		await writeFile(
			join(home, "inputs", "plans.csv"),
			"Client,Plan\nTestDB1,Gold\nTestDB2,Silver",
		);
		process.argv[1] = join(resultsDir, "squilo");

		configPath = join(home, "config.json");
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await SquiloServer({
			configPath,
			resultsDir,
			inputsDir: join(home, "inputs"),
			maxOutput: 2_000,
		}).connect(serverTransport);
		await client.connect(clientTransport);

		emptyTargets = await call("targets");
		saved = await call("save_config", {
			config: {
				servers: {
					local: {
						server: sql.container.getHost(),
						port: sql.container.getMappedPort(1433),
						options: { encrypt: false },
						auth: {
							kind: "userAndPassword",
							user: "sa",
							password: SQL_PASSWORD,
						},
					},
				},
				targets: {
					clients: {
						server: "local",
						description: "Active clients",
						discover: {
							database: CLIENTS_MANAGER_DATABASE,
							query:
								"SELECT DatabaseName AS [Database], Name FROM Clients WHERE Active = 1",
						},
					},
					manager: { server: "local", databases: [CLIENTS_MANAGER_DATABASE] },
				},
			},
		});
	});

	afterAll(() => {
		process.argv[1] = script;
	});

	test("starts without a config", () => {
		expect(emptyTargets.text).toBe(
			`No targets in ${configPath} yet: set them up with the user through save_config.`,
		);
	});

	test("saves the config set up with the user", () => {
		expect(saved).toEqual({
			isError: false,
			text: `Saved ${configPath}. Targets: clients, manager.`,
		});
	});

	test("shows the config with passwords masked", async () => {
		const config = JSON.parse((await call("config")).text);
		expect(config.servers.local.auth.password).toBe("********");
	});

	test("keeps a masked password when saving", async () => {
		const config = JSON.parse((await call("config")).text);
		config.targets.first = { server: "local", databases: ["TestDB1"] };
		expect((await call("save_config", { config })).isError).toBe(false);

		expect(
			JSON.parse((await call("databases", { target: "first" })).text),
		).toEqual([{ Database: "TestDB1" }]);
		delete config.targets.first;
		await call("save_config", { config });
	});

	test("rejects an invalid config", async () => {
		const result = await call("save_config", {
			config: {
				servers: {},
				targets: { orphan: { server: "none", databases: ["A"] } },
			},
		});
		expect(result.isError).toBe(true);
		expect(result.text).toContain('Unknown server "none"');
	});

	test("lists the targets", async () => {
		expect(JSON.parse((await call("targets")).text)).toEqual([
			{
				name: "clients",
				description: "Active clients",
				server: sql.container.getHost(),
				databases: `discovered in ${CLIENTS_MANAGER_DATABASE}`,
			},
			{
				name: "manager",
				server: sql.container.getHost(),
				databases: [CLIENTS_MANAGER_DATABASE],
			},
		]);
	});

	test("lists the databases a target discovers", async () => {
		expect(
			JSON.parse((await call("databases", { target: "clients" })).text),
		).toEqual(DATABASES.map((name) => ({ Database: name, Name: name })));
	});

	test("reports why discovery failed", async () => {
		const config = JSON.parse((await call("config")).text);
		config.targets.broken = {
			server: "local",
			discover: { database: "Missing", query: "SELECT 'A' AS [Database]" },
		};
		await call("save_config", { config });

		const result = await call("databases", { target: "broken" });
		delete config.targets.broken;
		await call("save_config", { config });

		expect(result.isError).toBe(true);
		expect(result.text).toStartWith("ConnectionError: ");
	});

	test("reports a Squilo error a script throws", async () => {
		const result = await call("run", {
			code: `
				const [errors] = await target("clients", { databases: ["TestDB1"] })
					.Retrieve((sql) => sql\`SELECT * FROM Missing\`)
					.Output(MergeOutputStrategy());
				throw errors[0].error;
			`,
		});
		expect(result).toEqual({
			isError: true,
			text: "RequestError: Invalid object name 'Missing'.",
		});
	});

	test("retrieves from every database with its discovery row", async () => {
		const [errors, rows] = await run(`
			return target("clients")
				.Retrieve(async (sql, database) => (await sql\`SELECT DB_NAME() AS name\`)[0].name + "/" + database.Name)
				.Output(MergeOutputStrategy());
		`);
		expect(errors).toEqual([]);
		expect(rows.sort()).toEqual(DATABASES.map((name) => `${name}/${name}`));
	});

	test("transforms each database's data", async () => {
		const [, rows] = await run(`
			return target("clients", { databases: ["TestDB1"] })
				.Retrieve((sql) => sql\`SELECT 2 AS n\`)
				.Transform((rows) => rows.map((row) => row.n * 10))
				.Output(MergeOutputStrategy());
		`);
		expect(rows).toEqual([20]);
	});

	test("combines targets and inputs in JavaScript", async () => {
		const result = await run(`
			const [, active] = await target("manager")
				.Retrieve((sql) => sql\`SELECT DatabaseName FROM Clients WHERE Active = 1\`)
				.Output(MergeOutputStrategy());
			const plans = await input("plans.csv");
			return { inputs: await inputs(), gold: plans.filter((p) => p.Plan === "Gold" && active.some((a) => a.DatabaseName === p.Client)) };
		`);
		expect(result).toEqual({
			inputs: ["plans.csv"],
			gold: [{ Client: "TestDB1", Plan: "Gold" }],
		});
	});

	test("sends interpolated values as parameters", async () => {
		const [, rows] = await run(`
			return target("clients", { databases: ["TestDB2"] })
				.Retrieve((sql) => sql\`SELECT \${"O'Brien"} AS name\`)
				.Output(MergeOutputStrategy());
		`);
		expect(rows).toEqual([{ name: "O'Brien" }]);
	});

	test("runs inside a transaction, one sql call at a time", async () => {
		const [, rows] = await run(`
			return target("clients", { databases: ["TestDB1"] })
				.Retrieve(async (sql) => {
					const [a, b] = await Promise.all([sql\`SELECT @@TRANCOUNT AS n\`, sql\`SELECT 2 AS n\`]);
					return a[0].n + b[0].n;
				})
				.Output(MergeOutputStrategy());
		`);
		expect(rows).toEqual([3]);
	});

	test("reports rejected writes as errors", async () => {
		const [errors, rows] = await run(`
			return target("clients", { databases: ["TestDB1"] })
				.Retrieve((sql) => sql\`CREATE TABLE Leak (Id INT)\`)
				.Output(MergeOutputStrategy());
		`);
		expect(rows).toEqual([]);
		expect(errors).toEqual([
			{
				database: "TestDB1",
				error: expect.objectContaining({
					message: 'Read-only query: "CREATE" is not allowed',
				}),
			},
		]);
		expect(errors[0].error.stack).toBeUndefined();
	});

	test("accepts a custom output strategy", async () => {
		const result = await run(`
			return target("clients").Retrieve(() => 1).Output(async (results) => {
				let total = 0;
				for await (const { data } of results) total += data;
				return total;
			});
		`);
		expect(result).toBe(DATABASES.length);
	});

	test("writes JSON and Excel files", async () => {
		const [jsonErrors, json] = await run(`
			return target("clients", { databases: ["TestDB1"] }).Retrieve((sql) => sql\`SELECT 1 AS n\`).Output(JsonOutputStrategy());
		`);
		const [xlsErrors, xls] = await run(`
			return target("clients", { databases: ["TestDB1"] }).Retrieve((sql) => sql\`SELECT 1 AS n\`).Output(XlsOutputStrategy());
		`);

		expect([jsonErrors, xlsErrors]).toEqual([[], []]);
		expect(json.startsWith(join(resultsDir, "squilo-"))).toBe(true);
		expect(JSON.parse(await readFile(json, "utf8"))).toEqual([
			{ database: "TestDB1", data: [{ n: 1 }] },
		]);
		expect(
			XLSX.utils.sheet_to_json(XLSX.read(await readFile(xls)).Sheets.TestDB1!),
		).toEqual([{ n: 1 }]);
	});

	test("fails on databases outside the target", async () => {
		const result = await call("run", {
			code: `return target("manager", { databases: ["TestDB1"] }).Retrieve(() => 1).Output(MergeOutputStrategy())`,
		});
		expect(result).toEqual({
			isError: true,
			text: 'Not in target "manager": TestDB1',
		});
	});

	test("saves a long result to a file", async () => {
		const result = await call("run", { code: "return 'x'.repeat(5000)" });
		const file = (await readdir(resultsDir)).find(
			(name) => !name.startsWith("squilo-"),
		);
		expect(result.text).toContain(
			`Full result saved to ${join(resultsDir, file!)}`,
		);
	});
});

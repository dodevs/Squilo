import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
	ElicitRequestSchema,
	type ElicitResult,
} from "@modelcontextprotocol/sdk/types.js";
import { SQL } from "squilo";
import {
	CONFIG,
	SQL_PASSWORD,
	UseSqlServer,
} from "../../squilo/test/container/container";
import { SetupDatabases } from "../../squilo/test/container/setup/databases";
import { SaveConfig } from "../src/config";
import { SquiloServer } from "../src/server";

const WRITABLE = ["TestDB1", "TestDB2"];

describe("plan and apply", () => {
	const sql = UseSqlServer(SetupDatabases);
	let configPath: string;
	let answer: ElicitResult;
	let message: string | undefined;

	const connect = async (client: Client) => {
		const home = await mkdtemp(join(tmpdir(), "squilo-"));
		const [clientTransport, serverTransport] =
			InMemoryTransport.createLinkedPair();
		await SquiloServer({
			configPath,
			resultsDir: join(home, "results"),
			inputsDir: join(home, "inputs"),
		}).connect(serverTransport);
		await client.connect(clientTransport);
		return client;
	};

	const client = new Client(
		{ name: "test", version: "0.0.0" },
		{ capabilities: { elicitation: { form: {} } } },
	);
	client.setRequestHandler(ElicitRequestSchema, async (request) => {
		message = request.params.message;
		return answer;
	});

	const call = async (name: string, args: Record<string, unknown>) => {
		const result = await client.callTool({ name, arguments: args });
		const [content] = result.content as { text: string }[];
		return { isError: result.isError === true, text: content!.text };
	};

	const query = async (database: string, text: string) => {
		const pool = await new SQL.ConnectionPool({
			...CONFIG(sql.container),
			database,
		}).connect();
		try {
			return (await pool.query(text)).recordset;
		} finally {
			await pool.close();
		}
	};

	const values = async (database: string) =>
		(await query(database, "SELECT Value FROM Items ORDER BY Id")).map(
			(row) => row.Value,
		);

	const STATEMENT = "UPDATE Items SET Value = Value + 1 WHERE Value < 3";
	const INCREMENT = `
		return target("writable").Execute(async (sql) => {
			await sql\`UPDATE Items SET Value = Value + 1 WHERE Value < \${3}\`;
		});
	`;

	beforeAll(async () => {
		configPath = join(await mkdtemp(join(tmpdir(), "squilo-")), "config.json");
		await SaveConfig(configPath, {
			servers: {
				local: {
					server: sql.container.getHost(),
					port: sql.container.getMappedPort(1433),
					options: { encrypt: false },
					auth: { kind: "userAndPassword", user: "sa", password: SQL_PASSWORD },
				},
			},
			targets: {
				readonly: { server: "local", databases: ["TestDB3"] },
				writable: { server: "local", databases: WRITABLE, allow: ["dml"] },
			},
		});
		await connect(client);
	});

	beforeEach(async () => {
		answer = { action: "accept", content: { confirm: true } };
		message = undefined;
		for (const database of WRITABLE) {
			await query(
				database,
				"DROP TABLE IF EXISTS Items; CREATE TABLE Items (Id INT, Value INT); INSERT INTO Items VALUES (1, 1), (2, 2), (3, 3)",
			);
		}
	});

	const plan = async (code: string) => {
		const result = await call("plan", { code });
		expect(result.isError).toBe(false);
		return JSON.parse(result.text);
	};

	test("are offered only to clients that can ask the user", async () => {
		const names = async (c: Client) =>
			(await c.listTools()).tools.map((tool) => tool.name);

		expect(await names(client)).toContain("apply");
		expect(
			await names(
				await connect(new Client({ name: "plain", version: "0.0.0" })),
			),
		).not.toContain("plan");
	});

	test("fit their descriptions in what clients keep, with the API in the code parameter", async () => {
		const { tools } = await client.listTools();
		const code = (name: string) =>
			(
				tools.find((tool) => tool.name === name)?.inputSchema.properties
					?.code as { description: string }
			).description;

		expect(tools).toHaveLength(7);
		expect(
			tools
				.filter(({ description = "" }) => description.length > 2_048)
				.map(({ name }) => name),
		).toEqual([]);
		expect(code("run")).toContain("MergeOutputStrategy");
		expect(code("run")).not.toContain("Execute");
		expect(code("plan")).toContain("Execute");
		expect(client.getInstructions()).toContain(
			"plan a script that uses Execute",
		);
	});

	test("run refuses Execute", async () => {
		expect(await call("run", { code: INCREMENT })).toEqual({
			isError: true,
			text: "Execute writes: use the plan tool, then apply",
		});
	});

	test("plan records the writes and the rows they change, and keeps nothing", async () => {
		const { planId, file, writes } = await plan(INCREMENT);

		expect(planId).toBeString();
		expect(writes).toEqual([
			{
				target: "writable",
				statements: [STATEMENT],
				databases: { TestDB1: [2], TestDB2: [2] },
			},
		]);
		expect(await readFile(file, "utf8")).toContain(
			`1. writable\n  Writes:\n    ${STATEMENT}\n  Databases:\n    TestDB1: 2 rows\n    TestDB2: 2 rows\n\nScript:\n${INCREMENT}`,
		);
		expect(await values("TestDB1")).toEqual([1, 2, 3]);
	});

	test("plan refuses writes the target does not allow", async () => {
		const { writes } = await plan(
			`return target("writable").Execute((sql) => sql\`DROP TABLE Items\`)`,
		);
		expect(writes[0].databases.TestDB1.error).toBe(
			'Error: "DROP" (DDL) is not allowed on this target',
		);

		expect(
			await call("plan", {
				code: `return target("readonly").Execute(async () => {})`,
			}),
		).toEqual({
			isError: true,
			text: 'Target "readonly" is read only: its config has no allow',
		});
	});

	test("apply commits once the user confirms", async () => {
		const { planId, file } = await plan(INCREMENT);
		const result = await call("apply", { planId });

		expect(result.isError).toBe(false);
		expect(JSON.parse(result.text).writes[0].databases).toEqual({
			TestDB1: [2],
			TestDB2: [2],
		});
		expect(message?.split("\n").slice(0, 3)).toEqual([
			"Commit 4 rows in 2 databases of writable?",
			STATEMENT,
			`Full plan: ${file}`,
		]);
		expect(await values("TestDB1")).toEqual([2, 3, 3]);
		expect(await values("TestDB2")).toEqual([2, 3, 3]);
		expect((await call("apply", { planId })).text).toContain("Unknown plan");
	});

	test("apply changes nothing when the user declines", async () => {
		const { planId } = await plan(INCREMENT);
		answer = { action: "decline" };

		expect(await call("apply", { planId })).toEqual({
			isError: false,
			text: "Not applied: the user did not confirm.",
		});
		expect(await values("TestDB1")).toEqual([1, 2, 3]);
	});

	test("apply rolls back a database whose rows changed since the plan", async () => {
		const { planId } = await plan(INCREMENT);
		await query("TestDB2", "UPDATE Items SET Value = 3");

		const { writes } = JSON.parse((await call("apply", { planId })).text);

		expect(writes[0].databases.TestDB1).toEqual([2]);
		expect(writes[0].databases.TestDB2.error).toBe(
			"Error: Changed since the plan: planned [2] rows, found [0]",
		);
		expect(await values("TestDB1")).toEqual([2, 3, 3]);
		expect(await values("TestDB2")).toEqual([3, 3, 3]);
	});
});

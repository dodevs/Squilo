import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type Config,
	KeepPasswords,
	LoadConfig,
	MaskPasswords,
	ParseConfig,
	SaveConfig,
} from "../src/config";

const servers = {
	local: {
		server: "localhost",
		port: 1433,
		auth: { kind: "userAndPassword", user: "sa", passwordEnv: "SQL_PASSWORD" },
	},
};

const withPassword = (password: string): Config => ({
	servers: {
		local: {
			server: "localhost",
			auth: { kind: "userAndPassword", user: "sa", password },
		},
		azure: {
			server: "azure",
			auth: { kind: "msal", clientId: "id", authority: "authority" },
		},
	},
	targets: { local: { server: "local", databases: ["Test"] } },
});

const configPath = async () =>
	join(await mkdtemp(join(tmpdir(), "squilo-")), "nested", "config.json");

describe("ParseConfig", () => {
	test("keeps the mssql options of a server", () => {
		const config = ParseConfig({
			servers,
			targets: { local: { server: "local", databases: ["Test"] } },
		});
		expect(config.servers.local?.port).toBe(1433);
	});

	test("rejects a target of an unknown server", () => {
		expect(() =>
			ParseConfig({
				servers,
				targets: { remote: { server: "remote", databases: ["Test"] } },
			}),
		).toThrow('Unknown server "remote"');
	});

	test("requires either databases or discover", () => {
		expect(() =>
			ParseConfig({ servers, targets: { local: { server: "local" } } }),
		).toThrow("Set either databases or discover");
	});
});

describe("LoadConfig and SaveConfig", () => {
	test("loads an empty config when the file is missing", async () => {
		expect(await LoadConfig(await configPath())).toEqual({
			servers: {},
			targets: {},
		});
	});

	test("saves a config and backs up the previous one", async () => {
		const path = await configPath();
		await SaveConfig(path, withPassword("first"));
		await SaveConfig(path, withPassword("second"));

		expect(await LoadConfig(path)).toEqual(withPassword("second"));
		expect(JSON.parse(await readFile(`${path}.bak`, "utf8"))).toEqual(
			withPassword("first"),
		);
	});

	test("refuses to save an invalid config", async () => {
		const path = await configPath();
		await expect(
			SaveConfig(path, { servers: {}, targets: withPassword("x").targets }),
		).rejects.toThrow('Unknown server "local"');
	});

	test("reports an invalid file", async () => {
		const path = join(await mkdtemp(join(tmpdir(), "squilo-")), "config.json");
		await writeFile(path, "{}");
		await expect(LoadConfig(path)).rejects.toThrow("Invalid Squilo config");
	});
});

describe("passwords", () => {
	test("masks passwords", () => {
		expect(MaskPasswords(withPassword("secret"))).toEqual(
			withPassword("********"),
		);
	});

	test("puts back masked passwords and keeps new ones", () => {
		const previous = withPassword("secret");
		expect(KeepPasswords(withPassword("********"), previous)).toEqual(previous);
		expect(KeepPasswords(withPassword("new"), previous)).toEqual(
			withPassword("new"),
		);
	});
});

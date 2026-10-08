import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";

export type Auth =
	| {
			kind: "userAndPassword";
			user: string;
			password?: string;
			passwordEnv?: string;
	  }
	| { kind: "msal"; clientId: string; authority: string };

export type ServerEntry = {
	server: string;
	auth: Auth;
	[option: string]: unknown;
};

export type TargetEntry = {
	server: string;
	description?: string;
	databases?: string[];
	discover?: { database: string; query: string };
	concurrent?: number;
	timeout?: number;
	allow?: ("dml" | "ddl")[];
};

export type Config = {
	servers: Record<string, ServerEntry>;
	targets: Record<string, TargetEntry>;
};

const MASK = "********";

const Auth: z.ZodType<Auth> = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("userAndPassword"),
		user: z.string(),
		password: z
			.string()
			.optional()
			.describe("Stored in plain text: only for local development servers"),
		passwordEnv: z
			.string()
			.optional()
			.describe("Name of the environment variable that holds the password"),
	}),
	z.object({
		kind: z.literal("msal"),
		clientId: z.string().describe("Entra ID app registration (client) id"),
		authority: z
			.string()
			.describe("https://login.microsoftonline.com/<tenant id>"),
	}),
]);

const ServerEntry: z.ZodType<ServerEntry> = z
	.looseObject({
		server: z.string().describe("Host name"),
		auth: Auth,
	})
	.describe(
		"Also takes mssql config options, e.g. port, requestTimeout, options: { encrypt, trustServerCertificate }",
	);

const TargetEntry: z.ZodType<TargetEntry> = z.object({
	server: z.string().describe("Key of a server in servers"),
	description: z
		.string()
		.optional()
		.describe("What the databases are, for whoever picks a target"),
	databases: z
		.array(z.string())
		.optional()
		.describe("A fixed list of databases. Set this or discover"),
	discover: z
		.object({
			database: z.string().describe("Database the query runs in"),
			query: z
				.string()
				.describe(
					"SELECT returning a [Database] column, plus any column scripts may use",
				),
		})
		.optional()
		.describe("Finds the databases with a query. Set this or databases"),
	concurrent: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("How many databases run at once (all when omitted)"),
	timeout: z
		.number()
		.int()
		.positive()
		.optional()
		.describe("Per-database time limit in milliseconds"),
	allow: z
		.array(z.enum(["dml", "ddl"]))
		.optional()
		.describe(
			"Writes plan/apply may run: dml (INSERT, UPDATE, DELETE, MERGE), ddl (CREATE, ALTER, DROP, TRUNCATE, EXEC). Read only when omitted: ask the user before allowing writes",
		),
});

export const ConfigShape: z.ZodType<Config> = z.object({
	servers: z.record(z.string(), ServerEntry),
	targets: z.record(z.string(), TargetEntry),
});

const ConfigSchema: z.ZodType<Config> = ConfigShape.superRefine(
	(config, ctx) => {
		for (const [name, target] of Object.entries(config.targets)) {
			if (!(target.server in config.servers)) {
				ctx.addIssue({
					code: "custom",
					path: ["targets", name, "server"],
					message: `Unknown server "${target.server}"`,
				});
			}
			if (!target.databases === !target.discover) {
				ctx.addIssue({
					code: "custom",
					path: ["targets", name],
					message: "Set either databases or discover",
				});
			}
		}
	},
);

export const ParseConfig = (json: unknown): Config => {
	const result = ConfigSchema.safeParse(json);
	if (!result.success) {
		throw new Error(`Invalid Squilo config:\n${z.prettifyError(result.error)}`);
	}
	return result.data;
};

const missing = (error: unknown) =>
	(error as NodeJS.ErrnoException).code === "ENOENT";

export const LoadConfig = async (path: string): Promise<Config> => {
	try {
		return ParseConfig(JSON.parse(await readFile(path, "utf8")));
	} catch (error) {
		if (missing(error)) {
			return { servers: {}, targets: {} };
		}
		throw error;
	}
};

export const SaveConfig = async (
	path: string,
	config: Config,
): Promise<void> => {
	await mkdir(dirname(path), { recursive: true });
	await copyFile(path, `${path}.bak`).catch((error) => {
		if (!missing(error)) throw error;
	});
	await writeFile(path, JSON.stringify(ParseConfig(config), null, "\t"));
};

const mapPasswords = (
	config: Config,
	fn: (password: string, server: string) => string,
): Config => ({
	...config,
	servers: Object.fromEntries(
		Object.entries(config.servers).map(([name, server]) => [
			name,
			server.auth.kind === "userAndPassword" &&
			server.auth.password !== undefined
				? {
						...server,
						auth: { ...server.auth, password: fn(server.auth.password, name) },
					}
				: server,
		]),
	),
});

export const MaskPasswords = (config: Config): Config =>
	mapPasswords(config, () => MASK);

/**
 * Puts back the passwords a masked config left as `********`.
 */
export const KeepPasswords = (config: Config, previous: Config): Config =>
	mapPasswords(config, (password, name) => {
		const auth = previous.servers[name]?.auth;
		return password === MASK && auth?.kind === "userAndPassword"
			? (auth.password ?? password)
			: password;
	});

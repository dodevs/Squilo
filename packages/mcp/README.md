# @squilo/mcp

![npm version](https://img.shields.io/npm/v/@squilo/mcp)
![license](https://img.shields.io/github/license/dodevs/Squilo)

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Claude Desktop, Claude Code) read SQL Server databases **with code**. The agent writes a JavaScript script made of Squilo pipelines: it runs a callback on every database of a target in parallel, then combines the results across databases, targets and input files.

Reads by default: each database runs inside a transaction that is always rolled back, and batches that write are rejected before they are sent. Writes go through `plan` and `apply`, on targets that allow them, after the user confirms them in a dialog.

## Tools

| Tool | What it does |
|---|---|
| `targets` | Lists the targets in the config |
| `databases` | Lists a target's databases, with the columns of its discovery query |
| `run` | Runs a script and returns what it returns |
| `config` | Shows the config, passwords masked |
| `save_config` | Validates and replaces the config, keeping the previous one as `config.json.bak` |
| `plan` | Runs a script that may write with `Execute`, records the rows each write changes per database, and rolls everything back |
| `apply` | Asks the user to confirm a plan, then runs it again and commits each database whose rows match the plan |

The script is the body of an async function with this in scope:

| Name | What it is |
|---|---|
| `target(name, { databases }?)` | Starts a pipeline: `.Retrieve(async (sql, database) => ...)`, optionally `.Transform(fn)`, then `.Output(strategy)` |
| `MergeOutputStrategy`, `JsonOutputStrategy`, `XlsOutputStrategy` | Squilo's output strategies. Json and Xls write their file to `~/.squilo/results` |
| `inputs()`, `input(name)` | List and read the files in `~/.squilo/inputs`: JSON parsed, CSV as rows, Excel as `{ [sheet]: rows }`, anything else as text |

```js
const [, clients] = await target("manager")
	.Retrieve((sql) => sql`SELECT [Database], Name FROM Client WHERE Active = ${1}`)
	.Output(MergeOutputStrategy());

const [errors, orders] = await target("tenants")
	.Retrieve(async (sql, database) => {
		const [row] = await sql`SELECT COUNT(*) AS Total FROM Orders WHERE CreatedAt >= ${"2026-01-01"}`;
		return { database: database.Database, total: row.Total };
	})
	.Output(MergeOutputStrategy());

const goals = await input("goals.xlsx");
return orders.map((o) => ({
	client: clients.find((c) => c.Database === o.database)?.Name,
	total: o.total,
	goal: goals.Goals.find((g) => g.Database === o.database)?.Goal,
}));
```

`sql` is a tagged template: interpolated values are sent as parameters. It resolves to the rows of the batch's first result set. `Retrieve` gets `sql` instead of Squilo's connection, which is what keeps the script read only.

## Config

The server reads `~/.squilo/config.json` (or the path given as its first argument) on every call, so changes apply right away. It starts without one: ask Claude to set Squilo up, and it asks for your servers and targets and saves them with `save_config` (your client asks you to approve the write). A password the tool shows as `********` keeps its saved value. Servers take the [mssql config](https://github.com/tediousjs/node-mssql#configuration-1) options plus an `auth`. A target is a fixed list of databases or a discovery query that returns a `Database` column.

```json
{
	"servers": {
		"local": {
			"server": "localhost",
			"port": 1433,
			"options": { "encrypt": false, "trustServerCertificate": true },
			"auth": { "kind": "userAndPassword", "user": "sa", "passwordEnv": "LOCAL_SQL_PASSWORD" }
		},
		"azure": {
			"server": "my-server.database.windows.net",
			"options": { "encrypt": true },
			"requestTimeout": 300000,
			"auth": {
				"kind": "msal",
				"clientId": "<app registration client id>",
				"authority": "https://login.microsoftonline.com/<tenant id>"
			}
		}
	},
	"targets": {
		"local:app": { "server": "local", "databases": ["App"] },
		"azure:tenants": {
			"server": "azure",
			"description": "Every active tenant database",
			"discover": {
				"database": "Tenants",
				"query": "SELECT [Database], Name FROM Tenant WHERE Active = 1"
			},
			"concurrent": 10,
			"timeout": 60000
		}
	}
}
```

| Field | Meaning |
|---|---|
| `auth.kind: "userAndPassword"` | SQL login. `passwordEnv` names an environment variable that holds the password. `password` stores it in plain text (and, set up through Claude, in the conversation): keep it for local development servers |
| `auth.kind: "msal"` | Entra ID: opens the browser on first use, then reuses the cached token |
| `targets.*.concurrent` | How many databases run at once. Unbounded when omitted |
| `targets.*.timeout` | Per-database time limit, in milliseconds |
| `targets.*.allow` | Writes `plan`/`apply` may run there: `"dml"` (INSERT, UPDATE, DELETE, MERGE) and/or `"ddl"` (CREATE, ALTER, DROP, TRUNCATE, EXEC, SELECT INTO). Read only when omitted |

The server keeps its state in `~/.squilo` (`SQUILO_HOME` changes it): the MSAL token cache, the `inputs` folder and the `results` folder, which holds the files the strategies write and the full output of results too long to return.

## Writes

```js
return target("tenants").Execute(async (sql) => {
	await sql`UPDATE Settings SET Enabled = ${1} WHERE Name = ${"NewFlow"}`;
});
```

1. `plan` runs the script. `Execute` runs on every database of the target, each in a transaction that is rolled back after the server records how many rows each write changed. A write the target's `allow` does not cover fails for that database. Transaction statements are never allowed.
2. `apply` shows the user a dialog written by the server, not by the model. Its first lines say how many rows change in how many databases, the first write with its values, and the path of the full plan (`~/.squilo/results/plan-<id>.txt`: every write, the rows per database and the script), which `plan` writes and the user can open first. If the user confirms, the same script runs again, and each database commits only if its writes change the same number of rows as in the plan. The others roll back and are reported.

`plan` and `apply` exist only for clients that support [form elicitation](https://modelcontextprotocol.io/specification/draft/client/elicitation), the dialog that makes the confirmation the user's own. Claude Code does. Elsewhere the server stays read only.

Each database commits on its own: if one fails in `apply`, those that already committed stay committed. A plan holds the locks of its writes until it rolls back, so give large targets a `timeout`.

## Install

### Claude Desktop

Build the extension and open it with Claude Desktop (double-click, or Settings > Extensions > Advanced settings > Install Extension):

```bash
cd packages/mcp
bun run pack:mcpb   # dist/squilo.mcpb
```

Then ask Claude to set Squilo up.

### Claude Code

```bash
claude mcp add --scope user squilo -- npx -y @squilo/mcp
```

The package is one bundled file (`dist/bin.js`) without dependencies, so `npx` starts it within the time MCP clients wait for a server.

## Limits

- Reads and the plan/apply rules are enforced by classifying each batch and by owning every transaction. Code runs inside the server process, so it is not a sandbox: for guarantees, connect with a login that has only the permissions a target needs (`db_datareader` for reads).
- `save_config` can change a target's `allow`. The user approves that write, and every `apply` still asks the user.
- SQL Server rejects concurrent requests on one transaction, so `sql` calls of one database run one after another.
- Scripts cannot `import` modules: the scope above is all they get.
- `SAFE_GUARD` applies as in Squilo: by default, after the first database fails, the databases that have not started are skipped.

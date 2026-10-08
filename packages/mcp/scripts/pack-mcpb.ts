/**
 * Builds the Claude Desktop extension: dist/squilo.mcpb, around the bundled dist/bin.js (bun run build).
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import manifest from "../mcpb/manifest.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };

const root = join(import.meta.dir, "..");
const staging = join(root, "dist", "mcpb");

await rm(staging, { recursive: true, force: true });
await mkdir(join(staging, "server"), { recursive: true });
await copyFile(join(root, "dist", "bin.js"), join(staging, "server", "index.js"));

await Bun.write(
	join(staging, "manifest.json"),
	JSON.stringify({ ...manifest, version: pkg.version }, null, "\t"),
);

const pack = Bun.spawn(
	[
		"bun",
		"x",
		"@anthropic-ai/mcpb@2.1.2",
		"pack",
		staging,
		join(root, "dist", "squilo.mcpb"),
	],
	{
		stdio: ["inherit", "inherit", "inherit"],
	},
);
process.exit(await pack.exited);

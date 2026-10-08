/**
 * Builds the Claude Desktop extension: dist/squilo.mcpb.
 *
 * The server and every dependency are bundled into one file, so the extension carries no node_modules.
 */
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import manifest from "../mcpb/manifest.json" with { type: "json" };
import pkg from "../package.json" with { type: "json" };

const root = join(import.meta.dir, "..");
const staging = join(root, "dist", "mcpb");

await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });

const build = await Bun.build({
	entrypoints: [join(root, "src", "bin.ts")],
	outdir: join(staging, "server"),
	naming: "index.js",
	target: "node",
	format: "esm",
});
if (!build.success) {
	throw new AggregateError(build.logs, "Bundling the server failed");
}

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

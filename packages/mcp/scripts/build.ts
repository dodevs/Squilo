/**
 * Bundles the server and every dependency into dist/bin.js.
 *
 * MCP clients start the server with npx: a package without dependencies installs in seconds,
 * while installing them took longer than the clients wait for a server to start.
 */
import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

await rm(join(root, "dist"), { recursive: true, force: true });

const build = await Bun.build({
	entrypoints: [join(root, "src", "bin.ts")],
	outdir: join(root, "dist"),
	naming: "bin.js",
	target: "node",
	format: "esm",
	minify: true,
});
if (!build.success) {
	throw new AggregateError(build.logs, "Bundling the server failed");
}

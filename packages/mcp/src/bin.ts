#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SquiloServer } from "./server";

// stdout carries the protocol: anything a library logs must go to stderr.
console.log = console.info = console.debug = console.error;

const home = process.env.SQUILO_HOME ?? join(homedir(), ".squilo");
const configPath = resolve(process.argv[2] ?? join(home, "config.json"));
const resultsDir = join(home, "results");

// The MSAL strategy keeps its token cache under the working directory.
await mkdir(join(home, ".active-directory-cache"), { recursive: true });
await mkdir(resultsDir, { recursive: true });
process.chdir(home);

// The Json and Xls output strategies name their files after the running script.
process.argv[1] = join(resultsDir, "squilo");

await SquiloServer({
	configPath,
	resultsDir,
	inputsDir: join(home, "inputs"),
}).connect(new StdioServerTransport());

import { defineWorkspace, type DefineConfigItem } from "bunup";

const config: DefineConfigItem = defineWorkspace(
	[
		{
			name: "squilo",
			root: "packages/squilo",
			config: {
				entry: ["src/index.ts"],
				dts: { splitting: true, resolve: ["mssql", /^@types\//] },
			},
		},
		{
			name: "msal-auth-strategy",
			root: "packages/msal-auth-strategy",
			config: {
				entry: ["src/index.ts"],
				dts: { resolve: ["@azure/msal-node"] },
			},
		},
		{
			name: "xls-output-strategy",
			root: "packages/xls-output-strategy",
			config: {
				entry: ["src/index.ts"],
				dts: { resolve: ["xlsx"] },
			},
		},
		{
			name: "mcp",
			root: "packages/mcp",
			config: {
				entry: ["src/index.ts", "src/bin.ts"],
			},
		},
	],
	{
		format: "esm",
		target: "node",
		sourcemap: "linked",
		splitting: true,
		exports: true,
	},
) as unknown as DefineConfigItem;

export default config;

import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { ListInputs, ReadInput } from "../src/inputs";

describe("inputs", () => {
	let dir: string;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "squilo-inputs-"));
		await mkdir(join(dir, "nested"));
		await writeFile(join(dir, "clients.json"), JSON.stringify([{ Id: 1 }]));
		await writeFile(
			join(dir, "plans.csv"),
			"Client,Plan\nAcme,Gold\nGlobex,Silver",
		);
		await writeFile(join(dir, "nested", "notes.txt"), "hello");

		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.json_to_sheet([{ Region: "South" }]),
			"Regions",
		);
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.json_to_sheet([{ Goal: 10 }]),
			"Goals",
		);
		await writeFile(
			join(dir, "targets.xlsx"),
			XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
		);
	});

	test("lists the files, nested ones included", async () => {
		expect((await ListInputs(dir)()).sort()).toEqual(
			[
				"clients.json",
				"nested",
				join("nested", "notes.txt"),
				"plans.csv",
				"targets.xlsx",
			].sort(),
		);
	});

	test("creates the folder when listing it", async () => {
		expect(await ListInputs(join(dir, "missing"))()).toEqual([]);
	});

	test("parses JSON", async () => {
		expect(await ReadInput(dir)("clients.json")).toEqual([{ Id: 1 }]);
	});

	test("reads CSV as rows", async () => {
		expect(await ReadInput(dir)("plans.csv")).toEqual([
			{ Client: "Acme", Plan: "Gold" },
			{ Client: "Globex", Plan: "Silver" },
		]);
	});

	test("reads every sheet of a workbook", async () => {
		expect(await ReadInput(dir)("targets.xlsx")).toEqual({
			Regions: [{ Region: "South" }],
			Goals: [{ Goal: 10 }],
		});
	});

	test("reads other files as text", async () => {
		expect(await ReadInput(dir)("nested/notes.txt")).toBe("hello");
	});

	test("refuses files outside the folder", async () => {
		await expect(
			ReadInput(join(dir, "nested"))("../clients.json"),
		).rejects.toThrow("outside the inputs folder");
	});
});

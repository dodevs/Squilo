import { mkdir, readdir, readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import * as XLSX from "xlsx";

const sheets = (workbook: XLSX.WorkBook) =>
	Object.fromEntries(
		workbook.SheetNames.map((name) => [
			name,
			XLSX.utils.sheet_to_json(workbook.Sheets[name]!),
		]),
	);

export const ListInputs = (dir: string) => async (): Promise<string[]> => {
	await mkdir(dir, { recursive: true });
	return readdir(dir, { recursive: true });
};

export const ReadInput =
	(dir: string) =>
	async (name: string): Promise<unknown> => {
		const path = resolve(dir, name);
		const inside = relative(dir, path);
		if (inside.startsWith("..") || isAbsolute(inside)) {
			throw new Error(`"${name}" is outside the inputs folder ${dir}`);
		}

		const content = await readFile(path);
		switch (extname(path).toLowerCase()) {
			case ".json":
				return JSON.parse(content.toString("utf8"));
			case ".csv":
				return Object.values(
					sheets(XLSX.read(content.toString("utf8"), { type: "string" })),
				)[0];
			case ".xlsx":
			case ".xls":
				return sheets(XLSX.read(content));
			default:
				return content.toString("utf8");
		}
	};

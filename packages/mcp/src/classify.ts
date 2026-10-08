export type Level = "read" | "dml" | "ddl" | "forbidden";

export type Classification = { level: Level; keyword?: string };

const RANK: Record<Level, number> = { read: 0, dml: 1, ddl: 2, forbidden: 3 };

const KEYWORDS: Record<string, Exclude<Level, "read">> = {
	INSERT: "dml",
	UPDATE: "dml",
	DELETE: "dml",
	MERGE: "dml",
	CREATE: "ddl",
	ALTER: "ddl",
	DROP: "ddl",
	TRUNCATE: "ddl",
	EXEC: "ddl",
	EXECUTE: "ddl",
	// The server owns the transaction; the rest reach beyond the database.
	COMMIT: "forbidden",
	ROLLBACK: "forbidden",
	SAVE: "forbidden",
	TRAN: "forbidden",
	TRANSACTION: "forbidden",
	USE: "forbidden",
	GRANT: "forbidden",
	REVOKE: "forbidden",
	DENY: "forbidden",
	BULK: "forbidden",
	BACKUP: "forbidden",
	RESTORE: "forbidden",
	DBCC: "forbidden",
	KILL: "forbidden",
	SHUTDOWN: "forbidden",
	RECONFIGURE: "forbidden",
	OPENROWSET: "forbidden",
	OPENQUERY: "forbidden",
	OPENDATASOURCE: "forbidden",
};

const BATCH_STARTS = new Set([
	"SELECT",
	"WITH",
	"DECLARE",
	"SET",
	"IF",
	"BEGIN",
	"WHILE",
	"PRINT",
]);

// Comments, string literals and quoted identifiers hold no statements.
const NOT_CODE =
	/--[^\n]*|\/\*[\s\S]*?\*\/|N?'(?:[^']|'')*'|\[(?:[^\]]|\]\])*\]|"(?:[^"]|"")*"/gi;

// SELECT ... INTO creates a table, unless it is a temporary one.
const SELECT_INTO_TABLE = /(?<!\b(?:INSERT|MERGE)\s+)\bINTO\s+(?![#@])/;

export const Classify = (sql: string): Classification => {
	const code = sql.replace(NOT_CODE, " ").toUpperCase();
	const words = code.match(/[A-Z_@#$][A-Z0-9_@#$]*/g) ?? [];
	let found: Classification = { level: "read" };

	const raise = (level: Level, keyword: string) => {
		if (RANK[level] > RANK[found.level]) {
			found = { level, keyword };
		}
	};

	// A batch that starts with a procedure name runs it without EXEC.
	const first = words[0];
	if (first !== undefined && !BATCH_STARTS.has(first) && !(first in KEYWORDS)) {
		raise("ddl", first);
	}
	for (const word of words) {
		const level = KEYWORDS[word];
		if (level) {
			raise(level, word);
		}
	}
	if (SELECT_INTO_TABLE.test(code)) {
		raise("ddl", "INTO");
	}

	return found;
};

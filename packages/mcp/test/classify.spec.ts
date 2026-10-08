import { describe, expect, test } from "bun:test";
import { Classify } from "../src/classify";

describe("Classify", () => {
	test.each([
		"SELECT * FROM Users",
		"select Id from Users where Name = 'DELETE FROM Users'",
		"WITH Active AS (SELECT * FROM Users) SELECT * FROM Active",
		"DECLARE @Update INT = 1; SELECT @Update",
		'SELECT [Update], "Delete" FROM Logs -- DROP TABLE Logs',
		"SELECT 1 /* EXEC sp_who */",
		"SELECT Id INTO #Temp FROM Users; SELECT * FROM #Temp",
		"SELECT N'it''s an UPDATE'",
		"SET NOCOUNT ON; SELECT 1",
	])("reads %p", (sql) => {
		expect(Classify(sql)).toEqual({ level: "read" });
	});

	test.each([
		["UPDATE Users SET Name = 'x'", "UPDATE"],
		["SELECT 1; DELETE FROM Users", "DELETE"],
		["WITH Old AS (SELECT * FROM Users) DELETE FROM Old", "DELETE"],
		["INSERT INTO Users (Name) VALUES ('x')", "INSERT"],
		[
			"MERGE INTO Users USING Staging ON 1 = 0 WHEN NOT MATCHED THEN INSERT (Id) VALUES (1);",
			"MERGE",
		],
	])("classifies %p as DML", (sql, keyword) => {
		expect(Classify(sql)).toEqual({ level: "dml", keyword });
	});

	test.each([
		["CREATE TABLE Leak (Id INT)", "CREATE"],
		["UPDATE Users SET Name = 'x'; ALTER TABLE Users ADD Age INT", "ALTER"],
		["SELECT 1; drop table Users", "DROP"],
		["TRUNCATE TABLE Users", "TRUNCATE"],
		["SELECT 1; EXEC sp_who", "EXEC"],
		["sp_rename 'Users', 'People'", "SP_RENAME"],
		["SELECT * INTO Archive FROM Users", "INTO"],
	])("classifies %p as DDL", (sql, keyword) => {
		expect(Classify(sql)).toEqual({ level: "ddl", keyword });
	});

	test.each([
		["SELECT 1; COMMIT", "COMMIT"],
		["BEGIN TRAN; UPDATE Users SET Name = 'x'", "TRAN"],
		["DROP TABLE Users; USE master", "USE"],
		["GRANT SELECT ON Users TO Public", "GRANT"],
	])("forbids %p", (sql, keyword) => {
		expect(Classify(sql)).toEqual({ level: "forbidden", keyword });
	});
});

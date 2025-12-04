import type { FileSink } from "bun";
import { ConnectionError, PreparedStatementError, RequestError, TransactionError } from "mssql";

export type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;

let customLogPath: string | null = null;

export const SetLogPath = (path: string) => {
    customLogPath = path;
    if (logWriter) {
        logWriter.end();
        logWriter = null;
    }
}

const getLogPath = () => {
    if (customLogPath) return customLogPath;
    const base = process.argv[1]?.replace(/\.(?:js|ts)/, '');
    return `${base}-last-errors.json`;
}

export const CleanErrors = async () => {
    if (logWriter) {
        logWriter.end();
        logWriter = null;
    }
    const path = getLogPath();
    if (await Bun.file(path).exists()) {
        await Bun.file(path).delete()
    }
}

let logWriter: FileSink | null = null;

const getWriter = () => {
    if (!logWriter) {
        logWriter = Bun.file(getLogPath()).writer();
    }
    return logWriter;
}

export const GetErrors = async () => {
    const writer = getWriter();
    writer.end();
    logWriter = null;

    return Bun.file(getLogPath())
        .text()
        .then(text => text.split('\n').filter(line => line !== ''))
        .then(lines => lines.map(line => JSON.parse(line)));
}

export const AppendError = (database: string, error: ErrorType) => {
    const writer = getWriter();

    const content = {
        database,
        error: {
            name: error.name,
            message: error.message,
            stack: error.stack,
            code: (error as any).code || undefined,
            number: (error as any).number || undefined,
            state: (error as any).state || undefined,
            class: (error as any).class || undefined,
            serverName: (error as any).serverName || undefined,
            procName: (error as any).procName || undefined,
            lineNumber: (error as any).lineNumber || undefined
        }
    };

    writer.write(JSON.stringify(content) + '\n');
    writer.flush();
}
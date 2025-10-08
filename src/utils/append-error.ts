import { ConnectionError, PreparedStatementError, RequestError, TransactionError } from "mssql";

export type ErrorType = Error | ConnectionError | TransactionError | RequestError | PreparedStatementError;

const BASE_FILENAME = process.argv[1]?.replace(/\.(?:js|ts)/, '');
const ERROR_LOG_PATH = `${BASE_FILENAME}-last-errors.json`;

export const CleanErrors = async () => {
    if (await Bun.file(ERROR_LOG_PATH).exists()) {
        await Bun.file(ERROR_LOG_PATH).delete()
    } 
}

export const AppendError = async (database: string, error: ErrorType) => {
    const errorFile = Bun.file(ERROR_LOG_PATH);
    const errorContent = await errorFile.exists() 
        ? await errorFile.json()
        : {};

    // Create a serializable error object
    const serializableError = {
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
    };

    // Update error content with new error for database
    const updatedContent = {
        ...errorContent,
        [database]: serializableError
    };

    // Write updated error content to file
    await Bun.write(errorFile, JSON.stringify(updatedContent, null, 2));
}
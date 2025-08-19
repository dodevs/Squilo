import {
    type AuthenticationResult,
    type Configuration,
    type ICachePlugin,
    type InteractiveRequest,
    LogLevel,
    type NodeAuthOptions,
    PublicClientApplication,
    type TokenCache,
    type TokenCacheContext,
} from "@azure/msal-node";

import * as path from "path";
import type { ServerConfig } from "../../server/types";
import type { AuthStrategy } from "..";
import { cwd } from "process";

const SCOPES = ["https://database.windows.net//.default"];

const cacheAccess = (hash: string) => {
    const cacheFilePath = path.join(cwd(), `${hash}.json`);

    const before = async (cacheContext: TokenCacheContext) => {
        try {
            const cacheFile = await Bun.file(cacheFilePath).text();
            cacheContext.tokenCache.deserialize(cacheFile);
        } catch (err) {
            await Bun.write(cacheFilePath, "");
            cacheContext.tokenCache.deserialize("");
        }
    };

    const after = async (cacheContext: TokenCacheContext) => {
        if (cacheContext.cacheHasChanged) {
            try {
                await Bun.write(cacheFilePath, cacheContext.tokenCache.serialize());
            } catch (err) {
                console.error(err);
            }
        }
    };

    return {
        beforeCacheAccess: before,
        afterCacheAccess: after,
    };
};

const msalConfig = (config: NodeAuthOptions, cachePlugin: ICachePlugin) => ({
    auth: config,
    cache: {
        cachePlugin,
    },
    system: {
        loggerOptions: {
            loggerCallback(loglevel, message) {
                console.log(message);
            },
            piiLoggingEnabled: false,
            logLevel: LogLevel.Error,
        },
    },
} as Configuration);

export const GetToken = async (config: NodeAuthOptions) => {
    const tenantId = config.authority?.replace("https://login.microsoftonline.com/", "");
    const clientId = config.clientId;

    const pca: PublicClientApplication = new PublicClientApplication(
        msalConfig(config, cacheAccess(`${tenantId}-${clientId}`)),
    );

    const tokenCache: TokenCache = pca.getTokenCache();

    async function getAccount() {
        return await tokenCache.getAllAccounts();
    }

    const accounts = await getAccount();
    let result: AuthenticationResult | null;

    if (accounts.length > 0 && accounts[0]) {
        result = await pca.acquireTokenSilent({
            scopes: SCOPES,
            account: accounts[0],
        });

        return result?.accessToken;
    }

    const interactiveRequest: InteractiveRequest = {
        scopes: SCOPES,
        openBrowser: async (url) => {
            const { default: open } = await import("open");
            open(url);
        },
        successTemplate: `
            <html lang="HTML5">
                <head>
                    <title>Authentication Success</title>
                </head>
                <script>
                    setTimeout(() => {
                        window.close();
                    }, 1000);
                </script>
                <body>
                    <h1>Authentication Success</h1>
                    <p>This window will be closed now</p>
                </body>
            </html>
        `,
    };

    result = await pca.acquireTokenInteractive(interactiveRequest);

    return result?.accessToken;
};

export const ActiveDirectoryAccessToken = async (config: NodeAuthOptions): Promise<AuthStrategy> => {
    const accessToken = await GetToken(config);
    return (config: ServerConfig) => {
        return {
            ...config,
            authentication: {
                type: 'azure-active-directory-access-token',
                options: {
                    token: accessToken
                }
            }
        }
    }
}

---
name: create-custom-auth-strategy
description: >
  Implement custom AuthStrategy for non-standard SQL Server authentication
  (certificates, Azure Key Vault tokens, custom identity providers).
  AuthStrategy returns new ServerConfig — never mutate input config.
  Signature: (config: ServerConfig) => config. Chain after Server().
type: core
library: squilo
library_version: "0.7.0-beta.3"
sources:
  - "dodevs/Squilo:packages/squilo/src/pipes/auth/strategies/types.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/auth/strategies/userAndPassword.ts"
  - "dodevs/Squilo:packages/squilo/src/pipes/server/types.ts"
---

# Squilo — Create Custom Auth Strategy

Implement a custom `AuthStrategy` when built-in strategies (`UserAndPassword`, `ActiveDirectoryAccessToken`) don't cover your authentication method. `AuthStrategy` is a function that takes `ServerConfig` and returns a modified `config` object.

## Setup

Minimum custom auth strategy:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const CustomAuth = (token: string): AuthStrategy => (config: ServerConfig) => ({
	...config,
	authentication: {
		type: "azure-active-directory-access-token",
		options: { token }
	}
});

const AzureServer = Server({
	server: "mydb.database.windows.net",
	port: 1433,
	options: { encrypt: true }
}).Auth(CustomAuth("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."));
```

## Core Patterns

### Certificate-based authentication

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const CertificateAuth = (
	certificate: string,
	certificatePassword?: string
): AuthStrategy => (config: ServerConfig) => ({
	...config,
	authentication: {
		type: "azure-active-directory-access-token",
		options: {
			token: certificate,
			certificate: certificatePassword
		}
	}
});

const CertServer = Server({
	server: "mydb.database.windows.net",
	port: 1433,
	options: { encrypt: true }
}).Auth(CertificateAuth("MIIEpAIBAAKCAQEA2...", "cert-password"));
```

### Azure Key Vault token resolution

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";
import { DefaultAzureCredential } from "@azure/identity";

const KeyVaultAuth = async (
	vaultUrl: string,
	secretName: string
): Promise<AuthStrategy> => {
	const credential = new DefaultAzureCredential();
	const client = new SecretClient(vaultUrl, credential);
	const secret = await client.getSecret(secretName);

	return (config: ServerConfig) => ({
		...config,
		authentication: {
			type: "azure-active-directory-access-token",
			options: { token: secret.value }
		}
	});
};

const VaultServer = Server({
	server: "mydb.database.windows.net",
	port: 1433,
	options: { encrypt: true }
}).Auth(await KeyVaultAuth("https://my-vault.vault.azure.net", "sql-token"));
```

### Custom identity provider with token refresh

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const RefreshingAuth = (
	getToken: () => Promise<string>
): AuthStrategy => (config: ServerConfig) => ({
	...config,
	authentication: {
		type: "azure-active-directory-access-token",
		options: {
			token: getToken() // Resolve token before connection
		}
	}
});

// Usage with token caching
const tokenCache = { token: null as string | null, expires: 0 };
const getToken = async () => {
	if (tokenCache.token && Date.now() < tokenCache.expires) {
		return tokenCache.token;
	}
	// Fetch new token from identity provider
	const response = await fetch("https://auth.example.com/token", {
		method: "POST",
		body: JSON.stringify({ grant_type: "client_credentials" })
	});
	const data = await response.json();
	tokenCache.token = data.access_token;
	tokenCache.expires = Date.now() + (data.expires_in * 1000) - 60000;
	return tokenCache.token;
};

const RefreshServer = Server({
	server: "mydb.database.windows.net",
	port: 1433,
	options: { encrypt: true }
}).Auth(await RefreshingAuth(getToken));
```

## Common Mistakes

### HIGH Mutating the input config object

Wrong:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const BadAuth = (token: string): AuthStrategy => (config: ServerConfig) => {
	// Mutating the input — affects other connections using same config
	config.authentication = {
		type: "azure-active-directory-access-token",
		options: { token }
	};
	return config;
};
```

Correct:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const GoodAuth = (token: string): AuthStrategy => (config: ServerConfig) => ({
	...config,
	authentication: {
		type: "azure-active-directory-access-token",
		options: { token }
	}
});
```

`AuthStrategy` receives a shared `ServerConfig` object. Mutating it can corrupt other connections. Always return a new object via spread syntax.

Source: packages/squilo/src/pipes/auth/strategies/types.ts

### HIGH Using wrong authentication type string

Wrong:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const WrongAuth = (token: string): AuthStrategy => (config: ServerConfig) => ({
	...config,
	authentication: {
		type: "azure-ad", // Wrong type string — mssql won't recognize this
		options: { token }
	}
});
```

Correct:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const CorrectAuth = (token: string): AuthStrategy => (config: ServerConfig) => ({
	...config,
	authentication: {
		type: "azure-active-directory-access-token", // Exact mssql type string
		options: { token }
	}
});
```

The `authentication.type` must match mssql's expected strings: `"default"`, `"ntlm"`, `"azure-active-directory-access-token"`, `"azure-active-directory-msi"`, `"azure-active-directory-service-principal-secret"`, `"azure-active-directory-interactive"`, or `"azure-active-directory-password"`.

Source: packages/squilo/src/pipes/auth/strategies/userAndPassword.ts

### MEDIUM Returning undefined or null from AuthStrategy

Wrong:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const BadAuth = (token: string): AuthStrategy => (config: ServerConfig) => {
	if (!token) {
		return undefined; // Returns undefined — pipeline crashes
	}
	return {
		...config,
		authentication: { type: "azure-active-directory-access-token", options: { token } }
	};
};
```

Correct:

```ts
import { Server } from "squilo";
import type { AuthStrategy, ServerConfig } from "squilo";

const GoodAuth = (token: string): AuthStrategy => (config: ServerConfig) => {
	if (!token) {
		throw new Error("Token is required for authentication");
	}
	return {
		...config,
		authentication: { type: "azure-active-directory-access-token", options: { token } }
	};
};
```

`AuthStrategy` must always return a `config` object. Returning `undefined` or `null` causes a crash when the pool tries to connect. Throw an error for invalid inputs.

Source: packages/squilo/src/pipes/auth/strategies/types.ts
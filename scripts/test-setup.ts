import { setDefaultTimeout } from "bun:test";

// bunfig.toml has no test timeout option; without this, tests and hooks get Bun's 5 s default.
setDefaultTimeout(60_000);

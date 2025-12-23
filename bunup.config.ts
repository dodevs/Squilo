import { defineConfig, type BuildOptions, type DefineConfigItem } from 'bunup'

const config: DefineConfigItem = defineConfig({
    entry: [
        './src/index.ts',
        './src/pipes/auth/strategies/index.ts',
        './src/pipes/output/strategies/index.ts',
    ],
    sourcemap: 'linked',
    format: 'esm',
    target: 'bun',
    unused: true,
    exports: {
        exclude: ['./pipes/**/*'],
        customExports: (ctx) => {
            return {
                "./auth": {
                    "import": {
                        "types": "./dist/pipes/auth/strategies/index.d.ts",
                        "default": "./dist/pipes/auth/strategies/index.js"
                    }
                },
                "./output": {
                    "import": {
                        "types": "./dist/pipes/output/strategies/index.d.ts",
                        "default": "./dist/pipes/output/strategies/index.js"
                    }
                },
            }
        },
    },
    splitting: true,
    //external,
    dts: {
        splitting: false
    }
}) as unknown as DefineConfigItem;

export default config;


type Env = {
    SAFE_GUARD: number;
}

type StringEnv = {
    [P in keyof Env]?: string
}

declare module "bun" {
    interface Env extends StringEnv { }
}

export const LoadEnv = (): Env => {
    const SAFE_GUARD = Number.parseInt(Bun.env.SAFE_GUARD || '1', 10);
    return {
        SAFE_GUARD: SAFE_GUARD
    }
}
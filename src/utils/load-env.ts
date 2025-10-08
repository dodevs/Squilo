type Env =  {
    MAX_ERRORS: number;
}

type StringEnv = {
    [P in keyof Env]?: string
}

declare module "bun" {
    interface Env extends StringEnv {}
}

export const LoadEnv = (): Env => {
    const MAX_ERRORS = Number.parseInt(Bun.env.MAX_ERRORS || '1', 10);
    return {
        MAX_ERRORS
    }
}
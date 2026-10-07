type Env = {
    SAFE_GUARD: number;
}

export const LoadEnv = (): Env => {
    const SAFE_GUARD = Number.parseInt(process.env.SAFE_GUARD || '1', 10);
    return {
        SAFE_GUARD: SAFE_GUARD
    }
}
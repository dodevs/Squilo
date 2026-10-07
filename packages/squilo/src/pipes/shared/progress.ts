import { Presets, SingleBar } from "cli-progress";

export type Progress = {
    start(total: number): void;
    update(database: string): void;
    increment(database: string): void;
    stop(): void;
}

const Silent: Progress = {
    start() { },
    update() { },
    increment() { },
    stop() { },
};

export const Progress = (): Progress => {
    if (process.env.NODE_ENV === "test") {
        return Silent;
    }

    const bar = new SingleBar({
        format: `{bar} {percentage}% | {value}/{total} | {database}`,
        hideCursor: true
    }, Presets.shades_classic);

    return {
        start: (total) => bar.start(total, 0),
        update: (database) => bar.update({ database }),
        increment: (database) => bar.increment(1, { database }),
        stop: () => bar.stop(),
    };
}

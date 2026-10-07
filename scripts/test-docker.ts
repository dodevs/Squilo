/**
 * Runs `bun test` inside a Linux Bun container that talks to the host's Docker.
 *
 * Needed where Bun can't reach the Docker daemon itself, e.g. on Windows, where Docker listens on a named
 * pipe (npipe:////./pipe/docker_engine) that testcontainers under Bun can't use.
 *
 * Usage: bun run test:docker [bun test args...]
 *   bun run test:docker
 *   bun run test:docker ./packages/squilo/test/connect.spec.ts
 */
const args = [
	"run",
	"--rm",
	// testcontainers in the container starts SQL Server through the host daemon...
	"-v",
	"/var/run/docker.sock:/var/run/docker.sock",
	// ...and reaches its mapped ports through the host.
	"--add-host=host.docker.internal:host-gateway",
	"-e",
	"TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal",
	"--mount",
	`type=bind,source=${process.cwd()},target=/app`,
	"-w",
	"/app",
	`oven/bun:${Bun.version}`,
	"bun",
	"test",
	...process.argv.slice(2),
];

const docker = Bun.spawn(["docker", ...args], { stdio: ["inherit", "inherit", "inherit"] });
process.exit(await docker.exited);

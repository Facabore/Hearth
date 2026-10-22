/**
 * The e2e server's address. `E2E_PORT` lets two worktrees run their e2e at once, each against its own build: the
 * server, its database container's label and every spec read the same port.
 */
export const E2E_PORT = process.env.E2E_PORT ?? "3100";
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;
/** The label of this run's database container: the teardown removes only its own run's containers. */
export const RUN_LABEL = `hearth.test.e2e.port=${E2E_PORT}`;

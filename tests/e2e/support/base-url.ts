import { E2E_SPA_PORT } from "../../../e2e-ports";

/** The e2e's ports live at the root (`e2e-ports.ts`), where the image's build can read them too. */
export { API_URL, E2E_PORT, E2E_SPA_PORT } from "../../../e2e-ports";
export const BASE_URL = `http://127.0.0.1:${E2E_SPA_PORT}`;
/** The label of this run's database container: the teardown removes only its own run's containers. */
export const RUN_LABEL = `hearth.test.e2e.port=${process.env.E2E_PORT ?? "3100"}`;
/** The label naming the Playwright run that owns a database container (playwright.config.ts, E2E_RUNNER_PID). */
export const RUNNER_LABEL = "hearth.test.e2e.runner";

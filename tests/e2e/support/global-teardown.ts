import { execFileSync } from "node:child_process";
import { RUN_LABEL } from "./base-url";

/**
 * Playwright force-kills the web server on Windows (taskkill /F) and, without `gracefulShutdown`, with SIGKILL elsewhere,
 * so the exit handler of scripts/e2e-server.mjs may never run: remove this run's e2e database containers here, never
 * a parallel run's on another port.
 */
export default function globalTeardown(): void {
  const ids = execFileSync(
    "docker",
    ["ps", "-aq", "--filter", "label=hearth.test=e2e", "--filter", `label=${RUN_LABEL}`],
    { encoding: "utf8" },
  )
    .split(/\s+/)
    .filter(Boolean);
  if (ids.length > 0) execFileSync("docker", ["rm", "-f", "--volumes", ...ids], { stdio: "ignore" });
}

import { execFileSync } from "node:child_process";
import { RUN_LABEL, RUNNER_LABEL } from "./base-url";

/** Whether the process still runs; EPERM means it runs under another user. */
const alive = (pid: string): boolean => {
  if (!/^\d+$/.test(pid) || pid === "0") return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

/**
 * Playwright force-kills the web server on Windows (taskkill /F) and, without `gracefulShutdown`, with SIGKILL elsewhere,
 * so the exit handler of scripts/e2e-server.mjs may never run: remove this run's e2e database containers here, never
 * a parallel run's on another port.
 *
 * On this port, only the containers this run owns, or those whose run is gone (killed before its teardown, or started
 * before containers named their run): a run that reused another run's servers (E2E_REUSE=1) leaves that run's
 * database alone, since removing it fails every test the owner still has to run.
 */
export default function globalTeardown(): void {
  const own = process.env.E2E_RUNNER_PID ?? String(process.pid);
  const ids = execFileSync(
    "docker",
    [
      "ps",
      "-a",
      "--filter",
      "label=hearth.test=e2e",
      "--filter",
      `label=${RUN_LABEL}`,
      "--format",
      `{{.ID}} {{.Label "${RUNNER_LABEL}"}}`,
    ],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter(([id]) => Boolean(id))
    .filter(([, runner = ""]) => runner === own || !alive(runner))
    .map(([id]) => id!);
  if (ids.length > 0) execFileSync("docker", ["rm", "-f", "--volumes", ...ids], { stdio: "ignore" });
}

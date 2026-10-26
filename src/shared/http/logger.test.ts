import { afterEach, describe, expect, it, vi } from "vitest";
import { leveledLogger } from "./logger";

afterEach(() => vi.restoreAllMocks());

const written = (level: Parameters<typeof leveledLogger>[0]) => {
  const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const logger = leveledLogger(level);
  logger.info("request", { status: 200 });
  logger.error("unhandled_route_error", { requestId: "r-1" });
  return log.mock.calls.map(([line]) => (JSON.parse(String(line)) as { event: string }).event);
};

describe("leveledLogger (HU-E8-02, LOG_LEVEL)", () => {
  it.each(["debug", "info"] as const)("writes info and errors at %s", (level) => {
    expect(written(level)).toEqual(["request", "unhandled_route_error"]);
  });

  it.each(["warn", "error"] as const)("drops info and still writes errors at %s", (level) => {
    expect(written(level)).toEqual(["unhandled_route_error"]);
  });
});

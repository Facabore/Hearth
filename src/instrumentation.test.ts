import { afterEach, describe, expect, it, vi } from "vitest";
import { register } from "./instrumentation";

const VALID = {
  DATABASE_URL: "postgres://hearth:secret@db:5432/hearth",
  BETTER_AUTH_SECRET: "a-secret-of-at-least-thirty-two-chars!",
  BETTER_AUTH_URL: "https://hearth.example.com",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const stubEnv = (vars: Record<string, string>) => {
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
};

describe("register", () => {
  it("exits with status 1 naming the missing variable when the Node.js server starts", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs", BETTER_AUTH_SECRET: "" });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await register();
    expect(exit).toHaveBeenCalledWith(1);
    expect(String(error.mock.calls[0]?.[0])).toContain("BETTER_AUTH_SECRET");
    expect(String(error.mock.calls[0]?.[0])).not.toContain(VALID.DATABASE_URL);
  });

  it("starts normally with a valid environment", async () => {
    stubEnv({ ...VALID, NEXT_RUNTIME: "nodejs" });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
  });

  it("does nothing outside the Node.js runtime", async () => {
    stubEnv({ NEXT_RUNTIME: "edge", BETTER_AUTH_SECRET: "" });
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    await register();
    expect(exit).not.toHaveBeenCalled();
  });
});

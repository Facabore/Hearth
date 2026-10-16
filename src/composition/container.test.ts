import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("getContainer", () => {
  // The first import loads the whole container module graph, which is slow under a loaded full run.
  it("is one container, and one database pool, per process even when its module is loaded twice (P20)", async () => {
    // Next.js bundles `instrumentation.ts`, which starts the recurring-transactions job, apart from the route
    // handlers, so both load this module: each copy must find the same container instead of building a second pool.
    vi.stubEnv("DATABASE_URL", "postgres://hearth:secret@127.0.0.1:5432/hearth");
    vi.stubEnv("BETTER_AUTH_SECRET", "a-secret-of-at-least-thirty-two-chars!");
    vi.stubEnv("BETTER_AUTH_URL", "https://hearth.example.com");
    vi.resetModules();
    const inInstrumentation = await import("./container");
    vi.resetModules();
    const inRouteHandlers = await import("./container");
    expect(inRouteHandlers).not.toBe(inInstrumentation);
    const container = inInstrumentation.getContainer();
    expect(inRouteHandlers.getContainer()).toBe(container);
    inInstrumentation.setContainerForTests(undefined);
    await container.pool.end();
  }, 30_000);
});

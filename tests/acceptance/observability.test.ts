import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as signIn } from "@/app/api/v1/auth/sign-in/route";
import { GET as health } from "@/app/api/v1/health/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, registerUser, startTestApp } from "../support/app";

let app: Container | undefined;
afterEach(async () => {
  setContainerForTests(undefined);
  await app?.pool.end();
  app = undefined;
  vi.restoreAllMocks();
});

describe("observability (HU-E8-02, issue #62)", () => {
  it("reports the database as ok on GET /api/v1/health while PostgreSQL answers", async () => {
    app = startTestApp();
    const response = await health(apiRequest("GET", "/api/v1/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("answers 503 with db unreachable when PostgreSQL cannot be reached", async () => {
    // Nothing listens on port 1, so the connection is refused at once.
    app = startTestApp({}, { DATABASE_URL: "postgres://hearth:hearth@127.0.0.1:1/hearth" });
    const response = await health(apiRequest("GET", "/api/v1/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", db: "unreachable" });
  });

  it("logs a sign-in with its request id, route, status and duration, and never the password, token or email", async () => {
    app = startTestApp({}, { LOG_LEVEL: "info" });
    const ana = await registerUser("Ana");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    const response = await signIn(
      apiRequest("POST", "/api/v1/auth/sign-in", { body: { email: ana.email, password: "123456789012" } }),
    );
    expect(response.status).toBe(200);
    const { token } = (await response.json()) as { token: string };
    const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0]!.split("=")[1]!);
    expect(lines.map((line) => JSON.parse(line) as Record<string, unknown>)).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "request",
        requestId: response.headers.get("x-request-id"),
        method: "POST",
        route: "/api/v1/auth/sign-in",
        status: 200,
        durationMs: expect.any(Number),
      }),
    );
    const log = lines.join("\n");
    for (const secret of [ana.email, "123456789012", token, ...cookies]) expect(log).not.toContain(secret);
  });
});

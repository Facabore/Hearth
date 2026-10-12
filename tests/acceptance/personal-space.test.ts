import { afterEach, describe, expect, it } from "vitest";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as listSpaces } from "@/app/api/v1/spaces/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, cookieHeader, startTestApp, uniqueEmail } from "../support/app";

let app: Container | undefined;
afterEach(async () => {
  setContainerForTests(undefined);
  await app?.pool.end();
  app = undefined;
});

const register = (email: string) =>
  signUp(
    apiRequest("POST", "/api/v1/auth/sign-up", { body: { name: "Ana", email, password: "123456789012" } }),
  );

describe("personal space on sign-up", () => {
  it("creates exactly one PERSONAL space in COP with MONTHLY(1) and Ana as OWNER", async () => {
    app = startTestApp();
    const created = await register(uniqueEmail("ana"));
    expect(created.status).toBe(201);
    const response = await listSpaces(
      apiRequest("GET", "/api/v1/spaces", { headers: { cookie: cookieHeader(created) } }),
    );
    expect(response.status).toBe(200);
    const { items } = await response.json();
    expect(items).toEqual([
      expect.objectContaining({
        name: "Personal",
        kind: "PERSONAL",
        currency: "COP",
        periodPolicy: { kind: "MONTHLY", day: 1 },
        role: "OWNER",
      }),
    ]);
  });

  it("shows each user only their own spaces", async () => {
    app = startTestApp();
    const ana = await register(uniqueEmail("ana"));
    await register(uniqueEmail("luis"));
    const response = await listSpaces(
      apiRequest("GET", "/api/v1/spaces", { headers: { cookie: cookieHeader(ana) } }),
    );
    expect((await response.json()).items).toHaveLength(1);
  });

  it("requires authentication to list spaces", async () => {
    app = startTestApp();
    const response = await listSpaces(apiRequest("GET", "/api/v1/spaces"));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("Unauthenticated");
  });

  it("rolls back the user when the personal space cannot be created", async () => {
    app = startTestApp({
      provisionUser: async () => {
        throw new Error("simulated database error");
      },
    });
    const email = uniqueEmail("ana");
    const response = await register(email);
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(response.headers.get("content-type")).toBe("application/problem+json");
    expect(body.code).toBe("InternalError");
    expect(body.requestId).toEqual(expect.any(String));
    const { rows } = await app.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email]);
    expect(rows[0].n).toBe(0);
  });
});

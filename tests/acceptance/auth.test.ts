import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signIn } from "@/app/api/v1/auth/sign-in/route";
import { POST as signOut } from "@/app/api/v1/auth/sign-out/route";
import { POST as signUp } from "@/app/api/v1/auth/sign-up/route";
import { GET as me } from "@/app/api/v1/me/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { apiRequest, cookieHeader, startTestApp, uniqueEmail } from "../support/app";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const register = (email: string, password = "123456789012") =>
  signUp(apiRequest("POST", "/api/v1/auth/sign-up", { body: { name: "Ana", email, password } }));
const login = (email: string, password = "123456789012") =>
  signIn(apiRequest("POST", "/api/v1/auth/sign-in", { body: { email, password } }));

describe("email and password authentication", () => {
  it("signs up Ana with defaults and a working, HttpOnly session cookie", async () => {
    const response = await register(uniqueEmail("ana"));
    expect(response.status).toBe(201);
    const { user } = await response.json();
    expect(user).toMatchObject({ name: "Ana", locale: "es", timezone: "America/Bogota" });
    expect(response.headers.getSetCookie().join("\n")).toMatch(/hearth\.session_token=[^;]+;.*HttpOnly/i);
    const current = await me(
      apiRequest("GET", "/api/v1/me", { headers: { cookie: cookieHeader(response) } }),
    );
    expect(current.status).toBe(200);
    expect((await current.json()).id).toBe(user.id);
  });

  it("rejects a duplicate email regardless of case", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const response = await register(email.toUpperCase());
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("EmailTaken");
    const { rows } = await app.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email]);
    expect(rows[0].n).toBe(1);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    const response = await register(uniqueEmail("ana"), "1234567");
    expect(response.status).toBe(422);
    expect((await response.json()).code).toBe("PasswordTooShort");
  });

  it("rejects a malformed email and a missing name as ValidationFailed", async () => {
    const response = await signUp(
      apiRequest("POST", "/api/v1/auth/sign-up", {
        body: { email: "not-an-email", password: "123456789012" },
      }),
    );
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("ValidationFailed");
    expect(body.errors.map((e: { path: string }) => e.path).sort()).toEqual(["email", "name"]);
  });

  it("returns the same generic error for a wrong password and an unknown email", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const wrong = await login(email, "wrong-password");
    const unknown = await login(uniqueEmail("nobody"), "whatever-password");
    const [a, b] = [await wrong.json(), await unknown.json()];
    expect([wrong.status, unknown.status]).toEqual([401, 401]);
    expect([a.code, b.code]).toEqual(["InvalidCredentials", "InvalidCredentials"]);
    expect(a.title).toBe(b.title);
  });

  it("signs in with different case and surrounding spaces in the email", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const response = await login(`  ${email.toUpperCase()} `);
    expect(response.status).toBe(200);
  });

  it("resolves the same user from the session cookie and the Bearer token", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const response = await login(email);
    const { token } = await response.json();
    expect(token).toEqual(expect.any(String));
    const viaCookie = await (
      await me(apiRequest("GET", "/api/v1/me", { headers: { cookie: cookieHeader(response) } }))
    ).json();
    const viaBearer = await (
      await me(apiRequest("GET", "/api/v1/me", { headers: { authorization: `Bearer ${token}` } }))
    ).json();
    expect(viaBearer.id).toBe(viaCookie.id);
  });

  it("rejects a forged Bearer token", async () => {
    const response = await me(
      apiRequest("GET", "/api/v1/me", { headers: { authorization: "Bearer forged" } }),
    );
    expect(response.status).toBe(401);
  });

  it("revokes the session on sign out", async () => {
    const created = await register(uniqueEmail("ana"));
    const cookie = cookieHeader(created);
    const out = await signOut(apiRequest("POST", "/api/v1/auth/sign-out", { headers: { cookie } }));
    expect(out.status).toBe(204);
    const after = await me(apiRequest("GET", "/api/v1/me", { headers: { cookie } }));
    expect(after.status).toBe(401);
    expect((await after.json()).code).toBe("Unauthenticated");
  });

  it("stores no plaintext password", async () => {
    const email = uniqueEmail("ana");
    await register(email);
    const { rows } = await app.pool.query(
      'SELECT a.password FROM account a JOIN "user" u ON u.id = a.user_id WHERE u.email = $1',
      [email],
    );
    expect(rows[0].password).toEqual(expect.any(String));
    expect(rows[0].password).not.toContain("123456789012");
  });
});

describe("sign-up provisioning", () => {
  it("removes the user again when provisioning fails, so the email can be reused", async () => {
    const failing = startTestApp({ provisionUser: async () => Promise.reject(new Error("boom")) });
    const email = uniqueEmail("ana");
    const response = await register(email);
    expect(response.status).toBe(500);
    const { rows } = await failing.pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [
      email,
    ]);
    expect(rows[0].n).toBe(0);
    await failing.pool.end();
    setContainerForTests(app);
  });
});

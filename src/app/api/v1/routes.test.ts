import { afterEach, describe, expect, it } from "vitest";
import { jsonLogger } from "@/shared/http";
import { ok, type AuthUser } from "@/shared/kernel";
import { setContainerForTests, type Container } from "@/composition/container";
import { GET as health } from "./health/route";
import { GET as me } from "./me/route";
import { GET as openapi } from "./openapi.json/route";

const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const RULES = { numberFormat: "DOT_COMMA", timeFormat: "H24", dateFormat: "DMY", weekStart: "MONDAY" };
const PREFERENCES = {
  stored: { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null },
  effective: RULES,
  defaults: RULES,
  locked: [],
};
const use = (resolve: (h: Headers) => Promise<AuthUser | null>) =>
  setContainerForTests({
    sessionResolver: { resolve },
    logger: jsonLogger,
    // HU-E1-15: GET /me answers the profile query; here with no stored format and the built-in rules.
    identity: { getProfile: async ({ user }: { user: AuthUser }) => ok({ user, preferences: PREFERENCES }) },
  } as unknown as Container);
const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { headers });

afterEach(() => setContainerForTests(undefined));

describe("foundation routes", () => {
  it("serves the OpenAPI document without credentials", async () => {
    use(async () => null);
    const response = await openapi(get("/api/v1/openapi.json"));
    expect(response.status).toBe(200);
    expect((await response.json()).openapi).toBe("3.1.0");
  });

  it("serves health without credentials", async () => {
    use(async () => null);
    const response = await health(get("/api/v1/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("rejects GET /me without credentials", async () => {
    use(async () => null);
    const response = await me(get("/api/v1/me"));
    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe("Unauthenticated");
  });

  it("returns the acting user from GET /me", async () => {
    use(async (h) => (h.get("authorization") === "Bearer t" ? ana : null));
    const response = await me(get("/api/v1/me", { authorization: "Bearer t" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...ana, preferences: PREFERENCES });
  });
});

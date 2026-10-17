import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { createSignUp as createSignUpWith, normalizeEmail, type SignUpDeps } from "./sign-up";

const ana: AuthUser = {
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
};
const session: AuthSession = { user: ana, token: "t", cookies: ["hearth.session_token=x"] };
const provider = (overrides: Partial<AuthProvider> = {}): AuthProvider => ({
  signUp: vi.fn(async () => ok(session)),
  signIn: vi.fn(async () => ok(session)),
  signOut: vi.fn(async () => ok({ cookies: [] })),
  deleteUser: vi.fn(async () => undefined),
  ...overrides,
});

const input = { name: "Ana", email: "a@b.co", password: "x" };
/** HU-E1-14: the zone port and the deployment default; existing tests sign up without a zone. */
const zones = () => ({
  profiles: { setTimeZone: vi.fn(async () => undefined) },
  defaultTimeZone: "America/Bogota",
});
const createSignUp = (deps: Pick<SignUpDeps, "auth" | "provisionUser">) =>
  createSignUpWith({ ...zones(), ...deps });

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("SignUp", () => {
  it("creates the account with a normalized email and provisions the user", async () => {
    const auth = provider();
    const provisionUser = vi.fn(async () => ok(undefined));
    const result = await createSignUp({ auth, provisionUser })({
      name: "Ana",
      email: " ANA@example.com",
      password: "123456789012",
    });
    expect(result).toEqual(ok(session));
    expect(auth.signUp).toHaveBeenCalledWith({
      name: "Ana",
      email: "ana@example.com",
      password: "123456789012",
    });
    expect(provisionUser).toHaveBeenCalledWith(ana);
    expect(auth.deleteUser).not.toHaveBeenCalled();
  });

  it("passes provider errors through unchanged without provisioning", async () => {
    const auth = provider({ signUp: vi.fn(async () => err(domainError("EmailTaken"))) });
    const provisionUser = vi.fn();
    const result = await createSignUp({ auth, provisionUser })({
      name: "Ana",
      email: "a@b.co",
      password: "x",
    });
    expect(!result.ok && result.error.code).toBe("EmailTaken");
    expect(provisionUser).not.toHaveBeenCalled();
  });

  it.each([
    ["returns an Err", async () => err(domainError("Boom"))],
    [
      "throws",
      async () => {
        throw new Error("db down");
      },
    ],
  ])("deletes the user and fails with InternalError when provisioning %s", async (_label, provisionUser) => {
    const auth = provider();
    const result = await createSignUp({ auth, provisionUser })({
      name: "Ana",
      email: "a@b.co",
      password: "x",
    });
    expect(!result.ok && result.error.code).toBe("InternalError");
    expect(auth.deleteUser).toHaveBeenCalledWith("u-ana");
  });

  it("tells a provisioning Err apart from a provisioning throw", async () => {
    const failing = await createSignUp({
      auth: provider(),
      provisionUser: async () => err(domainError("Boom")),
    })(input);
    const throwing = await createSignUp({
      auth: provider(),
      provisionUser: async () => {
        throw new Error("db down");
      },
    })(input);
    expect(!failing.ok && failing.error.details).toEqual({ cause: "Boom" });
    expect(!throwing.ok && throwing.error.details).toEqual({ cause: "ProvisioningThrew" });
  });

  it("still returns InternalError, flagged for follow-up, when the compensation fails", async () => {
    const auth = provider({ deleteUser: vi.fn(async () => Promise.reject(new Error("auth db down"))) });
    const result = await createSignUp({ auth, provisionUser: async () => err(domainError("Boom")) })(input);
    expect(!result.ok && result.error.code).toBe("InternalError");
    expect(!result.ok && result.error.details).toEqual({
      cause: "Boom",
      compensation: "failed",
      userId: "u-ana",
    });
  });
});

describe("SignUp time zone (HU-E1-14)", () => {
  const signUpWith = (
    setTimeZone: SignUpDeps["profiles"]["setTimeZone"],
    defaultTimeZone = "America/New_York",
  ) =>
    createSignUpWith({
      auth: provider(),
      provisionUser: async () => ok(undefined),
      profiles: { setTimeZone },
      defaultTimeZone,
    });

  it("stores the browser's zone by its canonical name", async () => {
    const setTimeZone = vi.fn(async () => undefined);
    const result = await signUpWith(setTimeZone)({ ...input, timezone: "europe/madrid" });
    expect(result.ok && result.value.user.timezone).toBe("Europe/Madrid");
    expect(setTimeZone).toHaveBeenCalledWith("u-ana", "Europe/Madrid");
  });

  it.each([undefined, "", "Mars/Olympus"])("falls back to APP_TIMEZONE for %j", async (timezone) => {
    const setTimeZone = vi.fn(async () => undefined);
    const result = await signUpWith(setTimeZone)({ ...input, timezone });
    expect(result.ok && result.value.user.timezone).toBe("America/New_York");
    expect(setTimeZone).toHaveBeenCalledWith("u-ana", "America/New_York");
  });

  it("writes nothing when the provider already holds the zone", async () => {
    const setTimeZone = vi.fn(async () => undefined);
    await signUpWith(setTimeZone, "America/Bogota")(input);
    expect(setTimeZone).not.toHaveBeenCalled();
  });

  it("provisions the user with the zone already applied", async () => {
    const provisionUser = vi.fn(async () => ok(undefined));
    await createSignUpWith({
      auth: provider(),
      provisionUser,
      profiles: { setTimeZone: async () => undefined },
      defaultTimeZone: "America/Bogota",
    })({ ...input, timezone: "europe/madrid" });
    expect(provisionUser).toHaveBeenCalledWith({ ...ana, timezone: "Europe/Madrid" });
  });

  it("removes the half-created user, and provisions nobody, when the zone cannot be stored", async () => {
    const auth = provider();
    const provisionUser = vi.fn(async () => ok(undefined));
    const result = await createSignUpWith({
      auth,
      provisionUser,
      profiles: { setTimeZone: async () => Promise.reject(new Error("db down")) },
      defaultTimeZone: "America/Bogota",
    })({ ...input, timezone: "Europe/Madrid" });
    expect(!result.ok && result.error.code).toBe("InternalError");
    expect(!result.ok && result.error.details).toEqual({ cause: "ProfileWriteThrew" });
    expect(provisionUser).not.toHaveBeenCalled();
    expect(auth.deleteUser).toHaveBeenCalledWith("u-ana");
  });
});

import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import {
  createSignUp as createSignUpWith,
  normalizeEmail,
  type SignUpDeps,
  type SignUpGate,
} from "./sign-up";

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
/** HU-E1-14: the zone port and the deployment default; existing tests sign up without a zone or a language. */
const zones = () => ({
  profiles: { setTimeZone: vi.fn(async () => undefined), saveProfile: vi.fn(async () => undefined) },
  defaultTimeZone: "America/Bogota",
});
/** Ruling P143: an open installation; its gate is never consulted. */
const openGate = (): SignUpGate => ({ mode: "open", admits: vi.fn(async () => false) });
const createSignUp = (deps: Pick<SignUpDeps, "auth" | "provisionUser">) =>
  createSignUpWith({ ...zones(), signUpGate: openGate(), ...deps });

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
      ...zones(),
      signUpGate: openGate(),
      auth: provider(),
      provisionUser: async () => ok(undefined),
      profiles: { setTimeZone, saveProfile: async () => undefined },
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
      ...zones(),
      signUpGate: openGate(),
      auth: provider(),
      provisionUser,
    })({ ...input, timezone: "europe/madrid" });
    expect(provisionUser).toHaveBeenCalledWith({ ...ana, timezone: "Europe/Madrid" });
  });

  it("removes the half-created user, and provisions nobody, when the zone cannot be stored", async () => {
    const auth = provider();
    const provisionUser = vi.fn(async () => ok(undefined));
    const result = await createSignUpWith({
      ...zones(),
      signUpGate: openGate(),
      auth,
      provisionUser,
      profiles: {
        setTimeZone: async () => Promise.reject(new Error("db down")),
        saveProfile: async () => undefined,
      },
    })({ ...input, timezone: "Europe/Madrid" });
    expect(!result.ok && result.error.code).toBe("InternalError");
    expect(!result.ok && result.error.details).toEqual({ cause: "ProfileWriteThrew" });
    expect(provisionUser).not.toHaveBeenCalled();
    expect(auth.deleteUser).toHaveBeenCalledWith("u-ana");
  });
});

describe("SignUp language (ruling P142)", () => {
  const signUpWith = (saveProfile: SignUpDeps["profiles"]["saveProfile"], auth = provider()) =>
    createSignUpWith({
      ...zones(),
      signUpGate: openGate(),
      auth,
      provisionUser: async () => ok(undefined),
      profiles: { setTimeZone: async () => undefined, saveProfile },
    });

  it("stores the visitor's language and answers it", async () => {
    const saveProfile = vi.fn(async () => undefined);
    const result = await signUpWith(saveProfile)({ ...input, locale: "en" });
    expect(result.ok && result.value.user.locale).toBe("en");
    expect(saveProfile).toHaveBeenCalledWith("u-ana", { locale: "en" });
  });

  it("provisions the user with the language already applied", async () => {
    const provisionUser = vi.fn(async () => ok(undefined));
    await createSignUpWith({ ...zones(), signUpGate: openGate(), auth: provider(), provisionUser })({
      ...input,
      locale: "en",
    });
    expect(provisionUser).toHaveBeenCalledWith({ ...ana, locale: "en" });
  });

  it.each([undefined, "es"] as const)(
    "keeps the stored default and writes nothing for %j",
    async (locale) => {
      const saveProfile = vi.fn(async () => undefined);
      const result = await signUpWith(saveProfile)({ ...input, locale });
      expect(result.ok && result.value.user.locale).toBe("es");
      expect(saveProfile).not.toHaveBeenCalled();
    },
  );

  it("does not pass the language to the provider", async () => {
    const auth = provider();
    await signUpWith(async () => undefined, auth)({ ...input, locale: "en" });
    expect(auth.signUp).toHaveBeenCalledWith({ name: "Ana", email: "a@b.co", password: "x" });
  });

  it("removes the half-created user, and provisions nobody, when the language cannot be stored", async () => {
    const auth = provider();
    const provisionUser = vi.fn(async () => ok(undefined));
    const result = await createSignUpWith({
      ...zones(),
      signUpGate: openGate(),
      auth,
      provisionUser,
      profiles: {
        setTimeZone: async () => undefined,
        saveProfile: async () => Promise.reject(new Error("db down")),
      },
    })({ ...input, locale: "en" });
    expect(!result.ok && result.error.code).toBe("InternalError");
    expect(!result.ok && result.error.details).toEqual({ cause: "ProfileWriteThrew" });
    expect(provisionUser).not.toHaveBeenCalled();
    expect(auth.deleteUser).toHaveBeenCalledWith("u-ana");
  });
});

describe("SignUp gate (ruling P143)", () => {
  const closedWith = (admits: SignUpGate["admits"]) => {
    const auth = provider();
    return {
      auth,
      signUp: createSignUpWith({
        ...zones(),
        auth,
        provisionUser: async () => ok(undefined),
        signUpGate: { mode: "closed", admits },
      }),
    };
  };

  it("refuses a closed installation without a token, and never reaches the provider", async () => {
    const admits = vi.fn(async () => true);
    const { auth, signUp } = closedWith(admits);
    const result = await signUp(input);
    expect(!result.ok && result.error.code).toBe("SignUpClosed");
    expect(admits).not.toHaveBeenCalled();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("refuses a token the gate does not admit, the same way, before the provider", async () => {
    const admits = vi.fn(async () => false);
    const { auth, signUp } = closedWith(admits);
    const result = await signUp({ ...input, invitationToken: "stale" });
    expect(!result.ok && result.error.code).toBe("SignUpClosed");
    expect(!result.ok && result.error.details).toBeUndefined();
    expect(admits).toHaveBeenCalledTimes(1);
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it("signs up a token the gate admits, asking it with the normalized email", async () => {
    const admits = vi.fn(async () => true);
    const { auth, signUp } = closedWith(admits);
    const result = await signUp({ ...input, email: " ANA@example.com", invitationToken: "t-1" });
    expect(result).toEqual(ok(session));
    expect(admits).toHaveBeenCalledWith({ token: "t-1", email: "ana@example.com" });
    expect(auth.signUp).toHaveBeenCalledWith({ name: "Ana", email: "ana@example.com", password: "x" });
  });

  it("lets an open installation ignore the token, and never asks the gate", async () => {
    const gate = openGate();
    const auth = provider();
    const result = await createSignUpWith({
      ...zones(),
      auth,
      provisionUser: async () => ok(undefined),
      signUpGate: gate,
    })({ ...input, invitationToken: "anything" });
    expect(result.ok).toBe(true);
    expect(gate.admits).not.toHaveBeenCalled();
    expect(auth.signUp).toHaveBeenCalledWith({ name: "Ana", email: "a@b.co", password: "x" });
  });
});

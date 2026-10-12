import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { createSignUp, normalizeEmail } from "./sign-up";

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

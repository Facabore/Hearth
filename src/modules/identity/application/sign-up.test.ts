import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { createSignIn } from "./sign-in";
import { createSignOut } from "./sign-out";
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
});

describe("SignIn", () => {
  it("normalizes the email before delegating", async () => {
    const auth = provider();
    await createSignIn(auth)({ email: " Ana@Example.com ", password: "p" });
    expect(auth.signIn).toHaveBeenCalledWith({ email: "ana@example.com", password: "p" });
  });

  it("passes InvalidCredentials through", async () => {
    const auth = provider({ signIn: vi.fn(async () => err(domainError("InvalidCredentials"))) });
    const result = await createSignIn(auth)({ email: "a@b.co", password: "p" });
    expect(!result.ok && result.error.code).toBe("InvalidCredentials");
  });
});

describe("SignOut", () => {
  it("forwards the caller's credentials", async () => {
    const auth = provider();
    await createSignOut(auth)({ cookie: "hearth.session_token=x" });
    expect(auth.signOut).toHaveBeenCalledWith({ cookie: "hearth.session_token=x" });
  });
});

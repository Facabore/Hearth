import { describe, expect, it, vi } from "vitest";
import { domainError, err, ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { createSignIn } from "./sign-in";

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

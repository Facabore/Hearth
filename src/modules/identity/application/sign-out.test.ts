import { describe, expect, it, vi } from "vitest";
import { ok, type AuthUser } from "@/shared/kernel";
import type { AuthProvider, AuthSession } from "./auth-provider";
import { createSignOut } from "./sign-out";

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

describe("SignOut", () => {
  it("forwards the caller's credentials", async () => {
    const auth = provider();
    await createSignOut(auth)({ cookie: "hearth.session_token=x" });
    expect(auth.signOut).toHaveBeenCalledWith({ cookie: "hearth.session_token=x" });
  });
});

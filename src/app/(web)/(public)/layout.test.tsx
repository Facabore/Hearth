import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";

const mocks = vi.hoisted(() => ({
  cookies: new Set<string>(),
  getMe: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  router: { refresh: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: (name: string) => mocks.cookies.has(name) }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => mocks.router }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/shared/ui/api/server", () => ({ getMe: mocks.getMe }));

const { default: PublicLayout } = await import("./layout");

describe("public layout (HU-E9-01, ruling P145): a signed-in person never sees the sign-in or sign-up screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.clear();
  });

  it("sends a person with a valid session to the home", async () => {
    mocks.cookies.add("hearth.session_token");
    mocks.getMe.mockResolvedValue({ id: "u1" });
    await expect(PublicLayout({ children: <p>form</p> })).rejects.toThrow("NEXT_REDIRECT /");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("shows the screen when the cookie is stale, so an expired session never loops", async () => {
    mocks.cookies.add("hearth.session_token");
    mocks.getMe.mockResolvedValue(null);
    renderWithIntl(await PublicLayout({ children: <p>form</p> }));
    expect(screen.getByText("form")).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("shows the screen without a cookie, and asks the API nothing", async () => {
    renderWithIntl(await PublicLayout({ children: <p>form</p> }));
    expect(screen.getByText("form")).toBeInTheDocument();
    expect(mocks.getMe).not.toHaveBeenCalled();
  });
});

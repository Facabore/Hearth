import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";

const mocks = vi.hoisted(() => ({
  cookies: new Set<string>(),
  path: null as string | null,
  getMe: vi.fn(),
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  }),
  router: { refresh: vi.fn(), replace: vi.fn() },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ has: (name: string) => mocks.cookies.has(name) }),
  headers: async () => ({ get: (name: string) => (name === "x-hearth-path" ? mocks.path : null) }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => mocks.router }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/shared/ui/api/server", () => ({ getMe: mocks.getMe }));

const { default: PublicLayout } = await import("./layout");

describe("public layout (HU-E9-01, ruling P145): a signed-in person never sees the sign-in or sign-up screens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cookies.clear();
    mocks.path = null;
  });

  it("sends a person with a valid session to the home", async () => {
    mocks.cookies.add("hearth.session_token");
    mocks.getMe.mockResolvedValue({ id: "u1" });
    mocks.path = "/sign-in";
    await expect(PublicLayout({ children: <p>form</p> })).rejects.toThrow("NEXT_REDIRECT /");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
  });

  it("sends a signed-in person on /sign-in?next=… to where next says, not to the home (N4)", async () => {
    mocks.cookies.add("hearth.session_token");
    mocks.getMe.mockResolvedValue({ id: "u1" });
    mocks.path = "/sign-in?next=%2Fspaces%2Fs1%2Ftransactions%3Fperiod%3D2026-10";
    await expect(PublicLayout({ children: <p>form</p> })).rejects.toThrow(
      "NEXT_REDIRECT /spaces/s1/transactions?period=2026-10",
    );
    expect(mocks.redirect).toHaveBeenCalledWith("/spaces/s1/transactions?period=2026-10");
  });

  it.each([
    "/sign-in?next=%2F%2Fevil.example",
    "/sign-in?next=https%3A%2F%2Fevil.example",
    "/sign-in?next=%2Fapi%2Fv1%2Fme",
    "/sign-in?next=%2Fsign-in",
  ])("still lands on the home when next is not a safe path: %s", async (path) => {
    mocks.cookies.add("hearth.session_token");
    mocks.getMe.mockResolvedValue({ id: "u1" });
    mocks.path = path;
    await expect(PublicLayout({ children: <p>form</p> })).rejects.toThrow("NEXT_REDIRECT /");
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

  it("answers an API outage with a styled way to retry instead of Next's bare error (N2)", async () => {
    mocks.cookies.add("hearth.session_token");
    mocks.getMe.mockRejectedValue(new Error("Reading the profile failed: Unknown"));
    renderWithIntl(await PublicLayout({ children: <p>form</p> }));
    expect(screen.getByRole("heading", { name: "No pudimos conectar con Hearth" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    expect(screen.queryByText("form")).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

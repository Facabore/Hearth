import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { fakeApi } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ProfileSheet } from "./profile-sheet";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const clearCookies = () => {
  for (const cookie of document.cookie.split("; ")) {
    document.cookie = `${cookie.split("=")[0]}=; path=/; max-age=0`;
  }
};

describe("profile sheet (HU-E9-01)", () => {
  beforeEach(() => {
    clearCookies();
    router.replace.mockClear();
    router.refresh.mockClear();
  });

  it("shows the person, links to settings, categories and accounts, and signs out to the sign-in screen", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/auth/sign-out": () => new Response(null, { status: 204 }),
    });
    renderWithIntl(
      <ProfileSheet
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaceId="sp-personal"
        spaceKind="PERSONAL"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Perfil de Ana" }));
    const sheet = screen.getByRole("dialog", { name: "Ana" });
    expect(within(sheet).getByText("ana@example.com")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: /Ajustes/ })).toHaveAttribute(
      "href",
      "/settings?from=sp-personal",
    );
    expect(within(sheet).getByRole("link", { name: /Cuentas/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts",
    );
    // HU-E9-04: Avatar › Categories, in every kind of space.
    expect(within(sheet).getByRole("link", { name: /Categorías/ })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/categories",
    );
    expect(within(sheet).queryByRole("link", { name: /Miembros/ })).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cerrar sesión" }));
    expect(requests[0]!.method).toBe("POST");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("keeps the person's stored language for the sign-in screen: the cookie is written before the sign-out call (ruling P149)", async () => {
    document.cookie = "hearth.locale=es; path=/";
    let cookieAtSignOut = "";
    const { api } = fakeApi({
      "POST /api/v1/auth/sign-out": () => {
        cookieAtSignOut = document.cookie;
        return new Response(null, { status: 204 });
      },
    });
    renderWithIntl(
      <ProfileSheet
        me={{ name: "Ana", email: "ana@example.com", locale: "en" }}
        spaceId="sp-personal"
        spaceKind="PERSONAL"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Perfil de Ana" }));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(cookieAtSignOut).toContain("hearth.locale=en");
    expect(document.cookie).toContain("hearth.locale=en");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
  });

  it("still keeps the language when the sign-out call fails", async () => {
    const { api } = fakeApi({ "POST /api/v1/auth/sign-out": () => new Response(null, { status: 500 }) });
    renderWithIntl(
      <ProfileSheet
        me={{ name: "Ana", email: "ana@example.com", locale: "en" }}
        spaceId="sp-personal"
        spaceKind="PERSONAL"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Perfil de Ana" }));
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(document.cookie).toContain("hearth.locale=en");
    expect(router.replace).toHaveBeenCalledWith("/sign-in");
  });

  it("links to the members of a shared space (ruling P160)", async () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <ProfileSheet
        me={{ name: "Ana", email: "ana@example.com", locale: "es" }}
        spaceId="sp-household"
        spaceKind="SHARED"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Perfil de Ana" }));
    const sheet = screen.getByRole("dialog", { name: "Ana" });
    expect(within(sheet).getByRole("link", { name: /Miembros e invitaciones/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members",
    );
  });
});

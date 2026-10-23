import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { NavLinks } from "./nav-links";

const where = vi.hoisted(() => ({ pathname: "/spaces/sp-household/plans/p-nov" }));
vi.mock("next/navigation", () => ({ usePathname: () => where.pathname }));

beforeEach(() => {
  where.pathname = "/spaces/sp-household/plans/p-nov";
});

const names = () =>
  within(screen.getByRole("navigation", { name: "Principal" }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent?.trim());

describe("the Plan tab (ruling P200, amends P141; P160 for the order)", () => {
  it("comes after Registrar and before Saldos, and is current on every plan screen", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" />);
    const plan = screen.getByRole("link", { name: "Plan" });
    expect(plan).toHaveAttribute("href", "/spaces/sp-household/plan");
    expect(plan).toHaveAttribute("aria-current", "page");
    expect(names()).toEqual(["Inicio", "Movimientos", "Registrar movimiento", "Plan", "Saldos"]);
  });

  it("is the last tab of a personal space, which has no Saldos", () => {
    renderWithIntl(<NavLinks spaceId="sp-personal" spaceKind="PERSONAL" />);
    expect(names()).toEqual(["Inicio", "Movimientos", "Registrar movimiento", "Plan"]);
  });

  it.each([
    "/spaces/sp-household/plan",
    "/spaces/sp-household/plan/members",
    "/spaces/sp-household/plans/p-nov/lines/new",
  ])("is current on %s", (pathname) => {
    where.pathname = pathname;
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" />);
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
  });

  it("is not current on the home, nor on a path that only starts with the same letters", () => {
    for (const pathname of ["/spaces/sp-household", "/spaces/sp-household/planning"]) {
      where.pathname = pathname;
      const { unmount } = renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" />);
      expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current");
      unmount();
    }
  });
});

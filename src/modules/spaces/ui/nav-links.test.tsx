import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { NavLinks } from "./nav-links";

const where = vi.hoisted(() => ({ pathname: "/spaces/sp-household/plans/p-nov", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => where.pathname,
  useSearchParams: () => new URLSearchParams(where.search),
}));

// The link's `prefetch` lands on the anchor, so a test can read what the router was asked to do.
vi.mock("next/link", () => ({
  default: ({ prefetch, children, ...props }: { prefetch?: boolean | null; children: ReactNode }) => (
    <a data-prefetch={prefetch === false ? "false" : "auto"} {...props}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  where.pathname = "/spaces/sp-household/plans/p-nov";
  where.search = "";
});

describe("the Registrar button (issue #172)", () => {
  it("carries the screen it is pressed on, with its query, as the form's returnTo", () => {
    where.pathname = "/spaces/sp-household";
    where.search = "period=2026-10";
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toHaveAttribute(
      "href",
      `/spaces/sp-household/new?returnTo=${encodeURIComponent("/spaces/sp-household?period=2026-10")}`,
    );
  });

  it("carries none on the record form itself", () => {
    where.pathname = "/spaces/sp-household/new";
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/new",
    );
  });
});

const names = () =>
  within(screen.getByRole("navigation", { name: "Principal" }))
    .getAllByRole("link")
    .map((link) => link.getAttribute("aria-label") ?? link.textContent?.trim());

describe("the Plan tab (ruling P200, amends P141; P160 for the order)", () => {
  it("comes after Registrar and before Saldos, and is current on every plan screen", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
    const plan = screen.getByRole("link", { name: "Plan" });
    expect(plan).toHaveAttribute("href", "/spaces/sp-household/plan");
    expect(plan).toHaveAttribute("aria-current", "page");
    expect(names()).toEqual(["Inicio", "Movimientos", "Registrar movimiento", "Plan", "Saldos"]);
  });

  it("is the last tab of a personal space, which has no Saldos", () => {
    renderWithIntl(<NavLinks spaceId="sp-personal" spaceKind="PERSONAL" canRecord />);
    expect(names()).toEqual(["Inicio", "Movimientos", "Registrar movimiento", "Plan"]);
  });

  it("leaves Registrar out for someone who cannot record in the space (#207)", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord={false} />);
    expect(names()).toEqual(["Inicio", "Movimientos", "Plan", "Saldos"]);
  });

  it.each([
    "/spaces/sp-household/plan",
    "/spaces/sp-household/plan/members",
    "/spaces/sp-household/plans/p-nov/lines/new",
  ])("is current on %s", (pathname) => {
    where.pathname = pathname;
    renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
    expect(screen.getByRole("link", { name: "Plan" })).toHaveAttribute("aria-current", "page");
  });

  it("is not current on the home, nor on a path that only starts with the same letters", () => {
    for (const pathname of ["/spaces/sp-household", "/spaces/sp-household/planning"]) {
      where.pathname = pathname;
      const { unmount } = renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
      expect(screen.getByRole("link", { name: "Plan" })).not.toHaveAttribute("aria-current");
      unmount();
    }
  });
});

describe("the navigation's prefetch (#196)", () => {
  const prefetches = () =>
    within(screen.getByRole("navigation", { name: "Principal" }))
      .getAllByRole("link")
      .map((link) => link.getAttribute("data-prefetch"));

  it.each(["/spaces/sp-household", "/spaces/sp-household/plans/p-nov", "/spaces/sp-household/members"])(
    "prefetches each tab's skeleton on %s, a screen of the space itself",
    (pathname) => {
      where.pathname = pathname;
      renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
      expect(new Set(prefetches())).toEqual(new Set(["auto"]));
    },
  );

  it.each(["/settings", "/spaces/new"])(
    "prefetches nothing on %s, which draws the shell itself: the space's shell would load its script a second time",
    (pathname) => {
      where.pathname = pathname;
      renderWithIntl(<NavLinks spaceId="sp-household" spaceKind="SHARED" canRecord />);
      expect(new Set(prefetches())).toEqual(new Set(["false"]));
    },
  );
});

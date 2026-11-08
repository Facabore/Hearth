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
    renderWithIntl(<NavLinks spaceId="sp-household" canRecord />);
    expect(screen.getByRole("link", { name: "Registrar movimiento" })).toHaveAttribute(
      "href",
      `/spaces/sp-household/new?returnTo=${encodeURIComponent("/spaces/sp-household?period=2026-10")}`,
    );
  });

  it("carries none on the record form itself", () => {
    where.pathname = "/spaces/sp-household/new";
    renderWithIntl(<NavLinks spaceId="sp-household" canRecord />);
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

describe("the Más tab (ruling P311, amends P200 and P302)", () => {
  it("comes after Saldos, where Plan was, opens the space's modules and leaves Plan out of the bar", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" canRecord />);
    const more = screen.getByRole("link", { name: "Más" });
    expect(more).toHaveAttribute("href", "/spaces/sp-household/more");
    expect(more.querySelector("svg")).not.toBeNull();
    expect(names()).toEqual(["Inicio", "Movimientos", "Registrar movimiento", "Saldos", "Más"]);
    expect(screen.queryByRole("link", { name: "Plan" })).toBeNull();
  });

  it("keeps the same five slots in a personal space, so Registrar stays in the middle of the bar (P302)", () => {
    renderWithIntl(<NavLinks spaceId="sp-personal" canRecord />);
    expect(names()).toEqual(["Inicio", "Movimientos", "Registrar movimiento", "Saldos", "Más"]);
    expect(screen.getByRole("link", { name: "Saldos" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/balances",
    );
  });

  it("leaves Registrar out for someone who cannot record in the space (#207)", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" canRecord={false} />);
    expect(names()).toEqual(["Inicio", "Movimientos", "Saldos", "Más"]);
  });

  it("is current on Más only", () => {
    for (const [pathname, current] of [
      ["/spaces/sp-household/more", true],
      ["/spaces/sp-household/plan", false],
      ["/spaces/sp-household", false],
    ] as const) {
      where.pathname = pathname;
      const { unmount } = renderWithIntl(<NavLinks spaceId="sp-household" canRecord />);
      const more = screen.getByRole("link", { name: "Más" });
      if (current) expect(more).toHaveAttribute("aria-current", "page");
      else expect(more).not.toHaveAttribute("aria-current");
      unmount();
    }
  });
});

describe("the Inicio tab (ruling P310, amends P125 for this tab)", () => {
  it("opens the personal Inicio from a shared space, and is not current there", () => {
    where.pathname = "/spaces/sp-household";
    renderWithIntl(<NavLinks spaceId="sp-household" homeSpaceId="sp-personal" canRecord />);
    const home = screen.getByRole("link", { name: "Inicio" });
    expect(home).toHaveAttribute("href", "/spaces/sp-personal");
    expect(home).not.toHaveAttribute("aria-current");
    // The other tabs stay the space's own.
    expect(screen.getByRole("link", { name: "Movimientos" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions",
    );
  });

  it("is current on the personal Inicio", () => {
    where.pathname = "/spaces/sp-personal";
    renderWithIntl(<NavLinks spaceId="sp-personal" homeSpaceId="sp-personal" canRecord />);
    expect(screen.getByRole("link", { name: "Inicio" })).toHaveAttribute("aria-current", "page");
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
      renderWithIntl(<NavLinks spaceId="sp-household" canRecord />);
      expect(new Set(prefetches())).toEqual(new Set(["auto"]));
    },
  );

  it.each(["/settings", "/spaces/new"])(
    "prefetches nothing on %s, which draws the shell itself: the space's shell would load its script a second time",
    (pathname) => {
      where.pathname = pathname;
      renderWithIntl(<NavLinks spaceId="sp-household" canRecord />);
      expect(new Set(prefetches())).toEqual(new Set(["false"]));
    },
  );
});

describe("the pending-occurrence badge on Movimientos (HU-E9-09, ruling P270)", () => {
  it("shows the count on the tab, and names it in the link", () => {
    renderWithIntl(<NavLinks spaceId="sp-household" canRecord pendingCount={2} />);
    const link = screen.getByRole("link", { name: "Movimientos, 2 por confirmar" });
    expect(link).toHaveAttribute("href", "/spaces/sp-household/transactions");
    expect(within(link).getByText("2")).toBeInTheDocument();
  });

  it("shows nothing at zero or without a count", () => {
    const { unmount } = renderWithIntl(<NavLinks spaceId="sp-household" canRecord pendingCount={0} />);
    expect(screen.getByRole("link", { name: "Movimientos" })).toBeInTheDocument();
    unmount();
    renderWithIntl(<NavLinks spaceId="sp-household" canRecord={false} />);
    expect(screen.getByRole("link", { name: "Movimientos" })).toBeInTheDocument();
  });
});

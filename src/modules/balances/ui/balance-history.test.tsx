import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { cop, memberDto, normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalanceHistory } from "./balance-history";

const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const SEPTEMBER = { label: "2026-09", startDate: "2026-09-01", endDate: "2026-09-30" };
const NOVEMBER = { label: "2026-11", startDate: "2026-11-01", endDate: "2026-11-30" };
// The story: Ana paid 300,000 EQUAL on 2026-10-03, Juan paid 100,000 EQUAL on 2026-10-10, Juan settled 100,000 on 2026-10-30.
const HISTORY = {
  memberId: "m-juan",
  from: "2026-10-01",
  to: "2026-10-31",
  opening: cop(0),
  closing: cop(0),
  entries: [
    {
      transactionId: "t-1",
      type: "EXPENSE" as const,
      date: "2026-10-03",
      description: "Mercado",
      change: cop(-150_000),
      balance: cop(-150_000),
    },
    {
      transactionId: "t-2",
      type: "EXPENSE" as const,
      date: "2026-10-10",
      description: "Cena",
      change: cop(50_000),
      balance: cop(-100_000),
    },
    {
      transactionId: "t-3",
      type: "SETTLEMENT" as const,
      date: "2026-10-30",
      description: "",
      change: cop(100_000),
      balance: cop(0),
    },
  ],
};

const view = (props: Partial<Parameters<typeof BalanceHistory>[0]> = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <BalanceHistory
      spaceId="sp-household"
      spaceName="Household"
      member={JUAN}
      period={OCTOBER}
      previous={SEPTEMBER}
      next={null}
      history={HISTORY}
      formats={BUILT_IN_FORMATS}
      {...props}
    />,
    { locale },
  );

describe("balance history (HU-E9-07, ruling P176)", () => {
  it("shows Juan's running balances of -150,000, -100,000 and 0 COP", async () => {
    const { container } = view();
    expect(screen.getByRole("heading", { level: 1, name: "Historial de Juan" })).toBeInTheDocument();
    expect(screen.getByText("1/10/2026 – 31/10/2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members/m-juan/history?from=2026-09-01",
    );
    expect(screen.queryByRole("link", { name: "Período siguiente" })).not.toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Saldo al inicio y al final" });
    expect(normalized(summary.textContent)).toContain("Al empezara paz y salvo");
    expect(normalized(summary.textContent)).toContain("Al terminara paz y salvo");
    const rows = within(
      screen.getByRole("region", { name: "Movimientos que cambian su saldo" }),
    ).getAllByRole("listitem");
    expect(rows.map((r) => normalized(r.textContent))).toEqual([
      "3/10/2026Mercadodebe $ 150.000−$ 150.000",
      "10/10/2026Cenadebe $ 100.000+$ 50.000",
      "30/10/2026Pago entre miembrosa paz y salvo+$ 100.000",
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("offers a way back to the balances: a real link of at least 44 x 44 px (the owner's UX rule)", () => {
    view();
    const back = screen.getByRole("link", { name: "Volver" });
    expect(back).toHaveAttribute("href", "/spaces/sp-household/balances");
    // Tailwind has no layout in jsdom: the 48 px target is pinned by its class.
    expect(back.className).toMatch(/\bsize-12\b/);
  });

  it("links the next period when there is one and reads the same in English", () => {
    view({ next: NOVEMBER, history: { ...HISTORY, opening: cop(-150_000), closing: cop(20_000) } }, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Juan's history" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next period" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members/m-juan/history?from=2026-11-01",
    );
    const summary = screen.getByRole("region", { name: "Balance at the start and at the end" });
    expect(normalized(summary.textContent)).toContain("At the startowes $ 150.000");
    expect(normalized(summary.textContent)).toContain("At the endis owed $ 20.000");
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
  });

  it("links to what Juan paid in the same period in Movimientos, in Spanish and English (issue #148)", () => {
    view();
    expect(screen.getByRole("link", { name: "Ver lo que pagó Juan" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions?period=2026-10&payer=m-juan",
    );
    view({}, "en");
    expect(screen.getByRole("link", { name: "See what Juan paid" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/transactions?period=2026-10&payer=m-juan",
    );
  });

  it("says when nothing changed the balance in the period", () => {
    view({ previous: null, history: { ...HISTORY, entries: [] } });
    expect(screen.getByText("Nada cambió su saldo en este período.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Período anterior" })).not.toBeInTheDocument();
  });
});

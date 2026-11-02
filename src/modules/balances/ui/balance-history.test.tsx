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
    // Board 04: the period is a chip with a calendar icon.
    const chip = screen.getByText("1/10/2026 – 31/10/2026").closest("[data-period-chip]");
    expect(chip).not.toBeNull();
    expect(chip!.querySelector("svg")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Período anterior" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/members/m-juan/history?from=2026-09-01",
    );
    expect(screen.queryByRole("link", { name: "Período siguiente" })).not.toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Saldo al inicio y al final" });
    // Board 04: a large neutral amount, then its state in words; a start at zero is the bare amount.
    expect(normalized(summary.textContent)).toBe("Al empezar$ 0Al terminar$ 0al día");
    expect(within(summary).getAllByText("$ 0")[0]).toHaveClass("text-ink");
    const rows = within(
      screen.getByRole("region", { name: "Movimientos que cambian su saldo" }),
    ).getAllByRole("listitem");
    // Board 04: a date column, the day over the short month.
    expect(rows.map((r) => normalized(r.textContent))).toEqual([
      "3octMercadole toca poner $ 150.000−$ 150.000",
      "10octCenale toca poner $ 100.000+$ 50.000",
      "30octPago entre miembrosal día+$ 100.000",
    ]);
    expect(within(rows[0]!).getByText("3")).toHaveClass("text-lg");
    // No extra row between the summary and the movements: the board has none (P272).
    expect(screen.queryByRole("link", { name: /Ver lo que pagó/ })).toBeNull();
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
    expect(normalized(summary.textContent)).toBe("At the start$ 150.000owesAt the end$ 20.000is owed");
    expect(screen.getByRole("link", { name: "Back" })).toBeInTheDocument();
    expect(normalized(screen.getAllByRole("listitem")[0]!.textContent)).toMatch(/^3Oct/);
  });

  it("says a balance's direction in words beside its neutral amount, never by color alone", () => {
    view({ history: { ...HISTORY, opening: cop(-150_000), closing: cop(20_000) } });
    const summary = screen.getByRole("region", { name: "Saldo al inicio y al final" });
    expect(normalized(summary.textContent)).toBe(
      "Al empezar$ 150.000le toca ponerAl terminar$ 20.000le toca recibir",
    );
    expect(within(summary).getByText("le toca poner")).toHaveClass("text-owe");
    expect(within(summary).getByText("le toca recibir")).toHaveClass("text-accent");
  });

  it("says when nothing changed the balance in the period", () => {
    view({ previous: null, history: { ...HISTORY, entries: [] } });
    expect(screen.getByText("Nada cambió su saldo en este período.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Período anterior" })).not.toBeInTheDocument();
  });
});

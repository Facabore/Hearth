import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e74Unified } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { UnifiedView } from "./unified-view";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const textOf = (name: string) => normalized(screen.getByRole("region", { name }).textContent);
/** U10 (#224): what was paid, and where it went, answer "¿Por qué es distinto?". */
const why = () => userEvent.click(screen.getByRole("button", { name: "¿Por qué es distinto?" }));
const SOURCES = "En qué se fue lo que pagaste";

describe("unified personal view (HU-E9-11)", () => {
  it("has one hero figure, Lo que gastaste tú, and Lo que pagaste as a secondary line (U10, #224)", async () => {
    const { container } = renderWithIntl(<UnifiedView view={e74Unified()} formats={BUILT_IN_FORMATS} />);
    const hero = screen.getByRole("region", { name: "Lo que gastaste tú" });
    expect(normalized(hero.textContent)).toBe(
      "Lo que gastaste tú$ 1.575.000Lo que fue para ti: tus gastos y tu parte de los compartidos.",
    );
    const paid = screen.getByRole("region", { name: "Lo que pagaste" });
    expect(normalized(paid.textContent)).toContain("Lo que pagaste$ 2.625.000");
    // The hero is the only large figure: the paid amount is a line of body text.
    expect(within(hero).getByText("$ 1.575.000")).toHaveClass("text-3xl");
    expect(within(paid).getByText("$ 2.625.000")).not.toHaveClass("text-3xl");
    // Folded, the answer and the breakdown stay out of the way.
    const button = within(paid).getByRole("button", { name: "¿Por qué es distinto?" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: SOURCES })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    await why();
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByText(
        "Lo que pagaste es lo que salió de tus bolsillos, aunque fuera para otros o para el fondo común. Lo que gastaste tú es solo lo que fue para ti.",
      ),
    ).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows where what was paid went, and Groceries of both spaces as one row", async () => {
    const { container } = renderWithIntl(<UnifiedView view={e74Unified()} formats={BUILT_IN_FORMATS} />);
    await why();
    const outs = textOf(SOURCES);
    expect(outs).toContain("Pagos de gastos$ 2.145.000");
    expect(outs).toContain("Aportes al fondo$ 480.000");
    expect(outs).not.toContain("Pagado fuera de la app");
    const groceries = screen.getAllByRole("listitem", { name: "Groceries" });
    expect(groceries).toHaveLength(1);
    expect(normalized(groceries[0]!.textContent)).toContain("$ 1.035.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists what a guest paid as paid outside the app, and names a custom category by its space", async () => {
    const pedro = e74Unified({
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
      consumption: {
        total: cop(100_000),
        categories: [
          {
            key: null,
            name: "Vet",
            space: { id: "sp-household", name: "Household" },
            category: { id: "c-vet", name: "Vet" },
            amount: cop(100_000),
          },
        ],
      },
      cashOut: {
        total: cop(300_000),
        payments: cop(0),
        fundContributions: cop(0),
        savingsTransfers: cop(0),
        outsideTheApp: cop(300_000),
      },
    });
    renderWithIntl(<UnifiedView view={pedro} formats={BUILT_IN_FORMATS} />);
    await why();
    expect(textOf(SOURCES)).toContain("Pagado fuera de la app$ 300.000");
    expect(screen.getByRole("listitem", { name: "Household / Vet" })).toBeInTheDocument();
  });

  it("lists the transfers to the person's savings among the sources, with the amount answered", async () => {
    const saver = e74Unified({
      cashOut: { ...e74Unified().cashOut, savingsTransfers: cop(150_000) },
    });
    renderWithIntl(<UnifiedView view={saver} formats={BUILT_IN_FORMATS} />);
    await why();
    expect(textOf(SOURCES)).toContain("Transferencias a tus ahorros$ 150.000");
  });

  it("says which spaces in another currency it leaves out", () => {
    renderWithIntl(
      <UnifiedView
        view={e74Unified({ otherCurrencySpaces: [{ spaceId: "sp-trip", name: "Trip", currency: "USD" }] })}
        formats={BUILT_IN_FORMATS}
      />,
    );
    expect(screen.getByText("Trip está en USD y no se suma aquí.")).toBeInTheDocument();
  });

  it("renders the totals as answered, never the sum of its rows (ruling P201)", () => {
    const view = e74Unified({
      consumption: { ...e74Unified().consumption, total: cop(7) },
      cashOut: { ...e74Unified().cashOut, total: cop(9) },
    });
    renderWithIntl(<UnifiedView view={view} formats={BUILT_IN_FORMATS} />);
    expect(textOf("Lo que gastaste tú")).toContain("$ 7");
    expect(textOf("Lo que gastaste tú")).not.toContain("1.575.000");
    expect(textOf("Lo que pagaste")).toContain("$ 9");
    expect(textOf("Lo que pagaste")).not.toContain("2.625.000");
  });

  it("fills the bar of the largest row and scales the others to it, for nobody's ears", () => {
    const { container } = renderWithIntl(<UnifiedView view={e74Unified()} formats={BUILT_IN_FORMATS} />);
    const bars = [...container.querySelectorAll("[data-bar]")] as HTMLElement[];
    expect(bars.map((bar) => bar.style.width)).toEqual(["100%", "46%", "5%"]);
    for (const bar of bars) expect(bar.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("keeps the API's order of rows, and says so when nothing was consumed", () => {
    renderWithIntl(<UnifiedView view={e74Unified()} formats={BUILT_IN_FORMATS} />);
    const rows = within(screen.getByRole("region", { name: "Consumo por categoría" })).getAllByRole(
      "listitem",
    );
    expect(rows.map((row) => normalized(row.textContent))).toEqual([
      "Groceries$ 1.035.000",
      "Rent$ 480.000",
      "Restaurants$ 60.000",
    ]);
    expect(screen.queryByText("No consumiste nada en este período.")).not.toBeInTheDocument();
    cleanup();
    const empty = e74Unified({ consumption: { total: cop(0), categories: [] } });
    renderWithIntl(<UnifiedView view={empty} formats={BUILT_IN_FORMATS} />);
    expect(screen.getByText("No consumiste nada en este período.")).toBeInTheDocument();
  });
});

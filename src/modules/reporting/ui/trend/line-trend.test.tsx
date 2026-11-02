import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { homeTrend, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { LineTrendDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { LineTrend } from "./line-trend";

vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const show = (trend: LineTrendDto = homeTrend(), locale: "es" | "en" = "es") =>
  renderWithIntl(<LineTrend space={householdDto()} trend={trend} formats={BUILT_IN_FORMATS} />, { locale });
const card = (name: string) => screen.getByRole("listitem", { name });
const status = (name: string) => normalized(card(name).querySelector("[data-status]")?.textContent ?? null);
const text = (name: string) => normalized(card(name).textContent);

/** `homeTrend()` with Home's last period changed, so a test changes only what it is about. */
const withHome = (last: Partial<LineTrendDto["lines"][number]["points"][number]>): LineTrendDto => {
  const trend = homeTrend();
  const home = trend.lines[0]!;
  home.points[home.points.length - 1] = { ...home.points.at(-1)!, ...last };
  return trend;
};

describe("line trend (HU-E9-11, board E9-11 04 under ruling P272)", () => {
  it("shows one card per line against the previous period, its status at the top and two bars", async () => {
    const { container } = show();
    const list = screen.getByRole("list", { name: "Gastado por rubro" });
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-line")),
    ).toEqual(["l-home", "l-pets"]);
    expect(status("Home")).toBe("Bajó");
    expect(text("Home")).toContain("Gastado en nov $ 1.300.000");
    expect(normalized(card("Home").querySelector("[data-change]")?.textContent ?? null)).toBe(
      "−$ 50.000 (−3,70 %)",
    );
    // October then November, each bar named by its short month; October's figure is read, not only drawn.
    expect(
      [...card("Home").querySelectorAll("[data-compare] [data-period]")].map((p) => p.textContent),
    ).toEqual(["oct", "nov"]);
    expect(text("Home")).toContain("Gastado en oct $ 1.350.000");
    expect(card("Home").querySelectorAll("[data-bar]")).toHaveLength(2);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("marks a new line with its badge and no previous period, without a percentage or bars", () => {
    show();
    expect(status("Pets")).toBe("Nueva");
    expect(text("Pets")).toContain("Gastado en nov $ 80.000");
    expect(text("Pets")).toContain("Sin período anterior");
    expect(text("Pets")).not.toContain("%");
    expect(card("Pets").querySelector("[data-compare]")).toBeNull();
  });

  it("draws no chart, no table and no window of periods: it compares with the previous period only", () => {
    const { container } = show();
    expect(container.querySelector("[data-chart-placeholder]")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("link", { name: /períodos$/ })).toBeNull();
  });

  it("says an unchanged line is the same, with its zero change and no bars", () => {
    show(withHome({ change: cop(0), changePercent: "0.00", changeStatus: "UNCHANGED" }));
    expect(status("Home")).toBe("Igual");
    expect(normalized(card("Home").querySelector("[data-change]")?.textContent ?? null)).toBe("$ 0 (0,00 %)");
    expect(card("Home").querySelector("[data-compare]")).toBeNull();
  });

  it("gives a rise its sign, its word and its arrow, never the color alone", () => {
    show(
      withHome({
        spent: cop(1_400_000),
        change: cop(50_000),
        changePercent: "3.70",
        changeStatus: "INCREASED",
      }),
    );
    expect(status("Home")).toBe("Subió");
    expect(card("Home").querySelector("[data-status] [data-tone]")).toHaveAttribute("data-tone", "owe");
    expect(card("Home").querySelector("[data-status] svg")).not.toBeNull();
    expect(normalized(card("Home").querySelector("[data-change]")?.textContent ?? null)).toBe(
      "+$ 50.000 (+3,70 %)",
    );
  });

  it("writes a line with no figure in the period as a dash with its reason for a screen reader", () => {
    show(withHome({ spent: null, change: null, changePercent: null, changeStatus: null }));
    expect(card("Home").querySelector("[aria-hidden='true']")).toHaveTextContent("—");
    expect(text("Home")).toContain("Sin dato");
  });

  it("reads the same in English", () => {
    show(homeTrend(), "en");
    expect(text("Home")).toContain("Spent in Nov");
    expect(status("Home")).toBe("Down");
  });

  it("says that a period without a plan has no lines to compare", () => {
    show({ ...homeTrend(), plan: null, lines: [] });
    expect(screen.getByText("Este período no tiene plan: no hay rubros que comparar.")).toBeInTheDocument();
  });
});

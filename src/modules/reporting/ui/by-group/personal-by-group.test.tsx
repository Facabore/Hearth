import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e74Groups } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { SpendingChart } from "./spending-chart";
import { treeOf } from "./spending-tree";

// Next syncs `useSearchParams` with the browser's own `pushState`: the mock does the same, so a drill click re-renders.
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const pushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args) => {
    pushState(...args);
    window.dispatchEvent(new Event("test:pushstate"));
  };
  const subscribe = (notify: () => void) => {
    window.addEventListener("popstate", notify);
    window.addEventListener("test:pushstate", notify);
    return () => {
      window.removeEventListener("popstate", notify);
      window.removeEventListener("test:pushstate", notify);
    };
  };
  return {
    notFound: vi.fn(() => {
      throw new Error("not found");
    }),
    redirect: vi.fn(),
    usePathname: () => window.location.pathname,
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          subscribe,
          () => window.location.search,
          () => "",
        ),
      ),
  };
});
const START = "/spaces/sp-personal/plan/groups?period=2026-11";
beforeEach(() => window.history.replaceState(null, "", START));
afterEach(() => window.history.replaceState(null, "", "/"));

const rows = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => li.querySelector("[data-cell]"))
    .map((li) => [...li.querySelectorAll("[data-cell]")].map((c) => normalized(c.textContent).trim()));
const drill = () => new URL(window.location.href).searchParams.getAll("drill");

describe("personal spending by group (HU-E9-11)", () => {
  it("merges seeded groups, labels a custom one by its space and drills into Food", async () => {
    const data = e74Groups();
    renderWithIntl(
      <SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />,
    );
    expect(rows()).toEqual([
      ["Food", "$ 1.095.000", "68,44 %"],
      ["Housing", "$ 480.000", "30,00 %"],
      ["Household / Pets", "$ 25.000", "1,56 %"],
    ]);
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(rows()).toEqual([
      ["Groceries", "$ 1.035.000", "94,52 %"],
      ["Restaurants", "$ 60.000", "5,48 %"],
    ]);
  });

  it("names a custom category and its group by their space at every level, and a merged one plainly", async () => {
    const data = e74Groups();
    renderWithIntl(
      <SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Household \/ Pets/ }));
    expect(rows()).toEqual([["Household / Vet", "$ 25.000", "100,00 %"]]);
    expect(screen.getByRole("list", { name: "Categorías de Household / Pets" })).toBeInTheDocument();
    // Vet holds only the entry of what was spent in the category itself: there is no level under it.
    expect(screen.queryByRole("button", { name: /^Household \/ Vet/ })).toBeNull();
    expect(drill()).toEqual(["g:g-pets"]);
  });

  it("gives every level a way back, the breadcrumb and the browser's Back (contrast in both themes is the e2e scan's)", async () => {
    const data = e74Groups();
    const { container } = renderWithIntl(
      <SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />,
    );
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    const trail = screen.getByRole("navigation", { name: "Ruta" });
    const back = within(trail).getByRole("button", { name: "Todos los grupos" });
    await userEvent.click(back);
    expect(drill()).toEqual([]);
    expect(rows().map((r) => r[0])).toEqual(["Food", "Housing", "Household / Pets"]);
    expect(new URL(window.location.href).searchParams.get("period")).toBe("2026-11");
  });

  it("shows the API's merged total, shares and bars without computing any (ruling P201)", () => {
    const data = e74Groups();
    // None of these add up: a sum, or a share the UI recomputes, would show a different figure.
    data.total = cop(7);
    data.groups[0] = { ...data.groups[0]!, total: cop(5), share: "11.11" };
    const { container } = renderWithIntl(
      <SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />,
    );
    expect(normalized(screen.getByText("Gasto total").closest("p")?.textContent)).toContain("$ 7");
    expect(rows()[0]).toEqual(["Food", "$ 5", "11,11 %"]);
    const bars = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars.map((bar) => bar.style.width)).toEqual(["11.11%", "30%", "1.56%"]);
  });

  it("shows a merged group that holds no live category by the name the API gave it", () => {
    const data = e74Groups();
    // Issue #130: a seeded group with no live category still names a merged row (the API answers its name).
    data.groups[1] = { ...data.groups[1]!, name: "Vivienda", categories: [] };
    renderWithIntl(
      <SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />,
    );
    expect(rows().map((r) => r[0])).toEqual(["Food", "Vivienda", "Household / Pets"]);
    expect(screen.queryByRole("button", { name: /^Vivienda/ })).toBeNull();
  });
});

describe("the By group view of the Plan tab by kind of space (ruling P200)", () => {
  it("keeps the personal note neutral: tú, never voseo, and says what merges", () => {
    expect(es.reports.byGroup.personalNote).toBe(
      "Tus gastos y tu parte de los compartidos, en todos tus espacios. Los grupos que trae Hearth se unen; los que creó un espacio llevan su nombre.",
    );
    expect(en.reports.byGroup.personalNote).toBe(
      "Your expenses and your share of shared ones, across all your spaces. Hearth's own groups are merged; groups a space created carry its name.",
    );
  });
});

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { e7Groups } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { readTrail, stepsBack } from "@/shared/ui/navigation/history";
import { NavigationTracker } from "@/shared/ui/navigation/navigation-tracker";
import { SpendingChart } from "./spending-chart";
import { treeOf, type NodeName } from "./spending-tree";

vi.mock("next/headers", () => ({}));
// Next syncs `useSearchParams` with the browser's own `pushState` and Back (it patches both), in a transition: the
// mock does the same, so a level that waits for the URL renders only after the click's own render.
vi.mock("next/navigation", async () => {
  const { startTransition, useEffect, useState } = await import("react");
  const pushState = window.history.pushState.bind(window.history);
  window.history.pushState = (...args) => {
    pushState(...args);
    // Not `popstate`: the browser fires none for a push, and the navigation tracker would read it as a Back.
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
    notFound: vi.fn(),
    redirect: vi.fn(),
    useSearchParams: () => {
      const [search, setSearch] = useState(() => window.location.search);
      useEffect(() => subscribe(() => startTransition(() => setSearch(window.location.search))), []);
      return new URLSearchParams(search);
    },
  };
});

const START = "/spaces/sp-household/plan/groups?period=2026-11";
beforeEach(() => window.history.replaceState(null, "", START));
afterEach(() => window.history.replaceState(null, "", "/"));

const rows = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => li.querySelector("[data-cell]"))
    .map((li) => [...li.querySelectorAll("[data-cell]")].map((c) => normalized(c.textContent).trim()));
const show = (data = e7Groups(), tree = treeOf(data.groups)) =>
  renderWithIntl(<SpendingChart tree={tree} total={data.total} formats={BUILT_IN_FORMATS} note="Nota" />);
const drill = () => new URL(window.location.href).searchParams.getAll("drill");
const trailNav = () => screen.getByRole("navigation", { name: "Ruta" });

describe("spending by group (HU-E9-10)", () => {
  it("drills from groups to categories to subcategories and back through the breadcrumb", async () => {
    const { container } = show();
    expect(rows()).toEqual([
      ["Housing", "$ 1.600.000", "56,94 %"],
      ["Food", "$ 960.000", "34,16 %"],
      ["Leisure", "$ 250.000", "8,90 %"],
    ]);
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(rows()).toEqual([
      ["Groceries", "$ 900.000", "93,75 %"],
      ["Restaurants", "$ 60.000", "6,25 %"],
    ]);
    const trail = trailNav();
    expect(within(trail).getByText("Food")).toHaveAttribute("aria-current", "location");
    expect(screen.queryByRole("button", { name: /^Restaurants/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /^Groceries/ }));
    expect(rows()).toEqual([
      ["Sin subcategoría", "$ 450.000", "50,00 %"],
      ["Vegetables", "$ 270.000", "30,00 %"],
      ["Meat", "$ 180.000", "20,00 %"],
    ]);
    expect(
      within(trail)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Todos los grupos", "Food"]);
    expect(within(trail).getByText("Groceries")).toHaveAttribute("aria-current", "location");
    expect(normalized(screen.getByText(/Total de Groceries/).closest("p")?.textContent)).toContain(
      "$ 900.000",
    );
    await userEvent.click(within(trail).getByRole("button", { name: "Food" }));
    expect(rows().map((r) => r[0])).toEqual(["Groceries", "Restaurants"]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("opens a level in the click's own render, before the router's transition catches up with the URL (#161)", async () => {
    show();
    const scope = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const actEnvironment = scope.IS_REACT_ACT_ENVIRONMENT;
    // A real click outside `act`: React renders the click's own update in a microtask and a transition in a task.
    scope.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      screen.getByRole("button", { name: /^Food/ }).click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(screen.getByRole("list", { name: "Categorías de Food" })).toBeInTheDocument();
      expect(drill()).toEqual(["g:g-food"]);
    } finally {
      scope.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
    }
    // Once the router has the URL, the level stays.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(rows().map((r) => r[0])).toEqual(["Groceries", "Restaurants"]);
  });

  it("makes each level a URL, so Back and the breadcrumb return one level at a time", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(drill()).toEqual(["g:g-food"]);
    // The period and the rest of the query stay.
    expect(new URL(window.location.href).searchParams.get("period")).toBe("2026-11");
    await userEvent.click(screen.getByRole("button", { name: /^Groceries/ }));
    expect(drill()).toEqual(["g:g-food", "c:c-groceries"]);
    await act(async () => window.history.back());
    await waitFor(() => expect(rows().map((r) => r[0])).toEqual(["Groceries", "Restaurants"]));
    expect(drill()).toEqual(["g:g-food"]);
    await userEvent.click(within(trailNav()).getByRole("button", { name: "Todos los grupos" }));
    expect(drill()).toEqual([]);
    expect(rows().map((r) => r[0])).toEqual(["Housing", "Food", "Leisure"]);
    expect(new URL(window.location.href).searchParams.get("period")).toBe("2026-11");
  });

  it("leaves each level in the navigation trail, so Volver from a screen opened at a level returns to that level", async () => {
    window.sessionStorage.clear();
    renderWithIntl(
      <>
        <NavigationTracker />
        <SpendingChart
          tree={treeOf(e7Groups().groups)}
          total={e7Groups().total}
          formats={BUILT_IN_FORMATS}
          note="Nota"
        />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Groceries/ }));
    const level = `${START}&drill=g%3Ag-food&drill=c%3Ac-groceries`;
    expect(readTrail().urls).toEqual([START, `${START}&drill=g%3Ag-food`, level]);
    // A screen opened from here: Volver goes one step back, to the exact level, not to the groups or the tab.
    window.history.pushState(null, "", "/spaces/sp-household/members");
    const trail = readTrail();
    expect(stepsBack(trail, "/spaces/sp-household/members")).toBe(1);
    expect(trail.urls[trail.pos - 1]).toBe(level);
  });

  it("opens at the level its URL names, as after a reload or a Volver, and ignores a level that is gone", () => {
    window.history.replaceState(null, "", `${START}&drill=g%3Ag-food&drill=c%3Ac-groceries`);
    const { unmount } = show();
    expect(rows().map((r) => r[0])).toEqual(["Sin subcategoría", "Vegetables", "Meat"]);
    unmount();
    window.history.replaceState(null, "", `${START}&drill=g%3Ag-food&drill=c%3Agone`);
    show();
    expect(rows().map((r) => r[0])).toEqual(["Groceries", "Restaurants"]);
  });

  it("moves the focus to the level's total when the level changes, so a keyboard never lands on the page", async () => {
    show();
    expect(document.body).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(screen.getByText(/Total de Food/).closest("p")).toHaveFocus();
  });

  it("marks an archived node with its badge", () => {
    const data = e7Groups();
    data.groups[2] = { ...data.groups[2]!, archived: true };
    show(data);
    expect(
      within(screen.getByRole("button", { name: /^Leisure/ })).getByText("Archivada"),
    ).toBeInTheDocument();
    expect(rows()[2]?.[0]).toBe("Leisure");
  });

  it("shows the API's shares, totals and bar widths without computing any (ruling P201)", () => {
    const data = e7Groups();
    // None of these add up: a sum or a recomputed share in the UI would show a different figure.
    data.total = cop(7);
    data.groups[0] = { ...data.groups[0]!, share: "11.11", total: cop(5) };
    const { container } = show(data);
    expect(normalized(screen.getByText("Gasto total").closest("p")?.textContent)).toContain("$ 7");
    expect(rows()[0]).toEqual(["Housing", "$ 5", "11,11 %"]);
    const bars = [...container.querySelectorAll<HTMLElement>("[data-bar]")];
    expect(bars.map((bar) => bar.style.width)).toEqual(["11.11%", "34.16%", "8.9%"]);
    for (const bar of bars) expect(bar.parentElement).toHaveAttribute("aria-hidden", "true");
  });

  it("writes a space-scoped node through one pattern and labels each level's list", async () => {
    const data = e7Groups();
    const tree = treeOf(data.groups);
    const scoped = (name: string): NodeName => ({ kind: "scoped", space: "Hogar", name });
    tree[1] = {
      ...tree[1]!,
      children: tree[1]!.children.map((c) => ({ ...c, name: scoped("Mercado") })),
    };
    show(data, tree);
    expect(screen.getByRole("list", { name: "Grupos" })).toBeInTheDocument();
    expect(screen.getByText("Toca un grupo para ver sus categorías.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    expect(rows().map((r) => r[0])).toEqual(["Hogar / Mercado", "Hogar / Mercado"]);
    expect(screen.getByRole("list", { name: "Categorías de Food" })).toBeInTheDocument();
    expect(screen.getByText("Toca una categoría para ver sus subcategorías.")).toBeInTheDocument();
  });

  it("speaks English with the same figures", async () => {
    const data = e7Groups();
    renderWithIntl(
      <SpendingChart tree={treeOf(data.groups)} total={data.total} formats={BUILT_IN_FORMATS} note="Note" />,
      { locale: "en" },
    );
    expect(screen.getByText("Tap a group to see its categories.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Food/ }));
    await userEvent.click(screen.getByRole("button", { name: /^Groceries/ }));
    expect(rows()[0]?.[0]).toBe("No subcategory");
    const trail = screen.getByRole("navigation", { name: "Path" });
    expect(within(trail).getAllByRole("button")[0]).toHaveTextContent("All groups");
  });
});

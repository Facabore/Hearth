import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, meDto, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { e74Groups, householdDto, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import en from "@/i18n/messages/en.json";
import es from "@/i18n/messages/es.json";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { SpendingByGroupContainer } from "./by-group-container";
import { GroupsHomeContainer } from "./groups-home";
import { loadPersonalByGroup, PersonalSpendingByGroupContainer } from "./personal-by-group-container";
import { SpendingChart } from "./spending-chart";
import { treeOf } from "./spending-tree";

const server = vi.hoisted(() => ({
  api: undefined as unknown,
  spaces: [] as unknown[],
  locale: "es" as "es" | "en",
}));

vi.mock("next/headers", () => ({}));
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
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: async () => meDto({ timezone: "America/Bogota" }),
  getSpaces: async () => server.spaces,
  serverApi: async () => server.api,
}));
vi.mock("@/shared/ui/time/server-now", () => ({ serverNow: () => new Date("2026-11-15T17:00:00Z") }));
vi.mock("next-intl/server", async () => ({
  getTranslations: async (namespace: string) => {
    const { createTranslator } = await import("next-intl");
    const messages = server.locale === "es" ? es : en;
    return createTranslator({ locale: server.locale, messages, namespace: namespace as never });
  },
}));

const personal = spaceDto({ id: "sp-personal", name: "Personal", kind: "PERSONAL", role: "OWNER" });
const START = "/spaces/sp-personal/plan/groups?period=2026-11";
beforeEach(() => window.history.replaceState(null, "", START));
afterEach(() => {
  window.history.replaceState(null, "", "/");
  server.locale = "es";
});

const rows = () =>
  screen
    .getAllByRole("listitem")
    .filter((li) => li.querySelector("[data-cell]"))
    .map((li) => [...li.querySelectorAll("[data-cell]")].map((c) => normalized(c.textContent).trim()));
const drill = () => new URL(window.location.href).searchParams.getAll("drill");

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const DECEMBER = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };
/** The period of the space that holds `from`, as the API answers it for a calendar month. */
const periods = (items?: readonly object[]) => ({
  "GET /api/v1/spaces/{spaceId}/periods": (request: Request) => {
    const from = new URL(request.url).searchParams.get("from") ?? "";
    const month = items ?? [
      from.startsWith("2026-10") ? OCTOBER : from.startsWith("2026-12") ? DECEMBER : NOVEMBER,
    ];
    return jsonResponse({ items: month });
  },
});

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

describe("the personal By group view loads once (HU-E9-11)", () => {
  it("reads the caller's own report for the personal space's period and its neighbours", async () => {
    const { api, requests } = fakeApi({
      ...periods(),
      "GET /api/v1/me/reports/spending-by-group": () => jsonResponse(e74Groups()),
    });
    const result = await loadPersonalByGroup(api, { spaceId: "sp-personal", today: "2026-11-15" });
    const report = requests.filter((r) => r.url.includes("/me/reports/spending-by-group"));
    expect(report).toHaveLength(1);
    expect(new URL(report[0]!.url).searchParams.get("period")).toBe("2026-11");
    // The period comes from the personal space, never from a shared one.
    const asked = requests.filter((r) => r.url.includes("/spaces/sp-personal/periods"));
    expect(asked).toHaveLength(3);
    expect(result.ok && result.data.report.groups.map((g) => g.name)).toEqual(["Food", "Housing", "Pets"]);
  });

  it("asks for the period of the URL without looking up today's", async () => {
    const { api, requests } = fakeApi({
      ...periods([{ label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" }]),
      "GET /api/v1/me/reports/spending-by-group": () => jsonResponse({ ...e74Groups(), period: NOVEMBER }),
    });
    await loadPersonalByGroup(api, { spaceId: "sp-personal", period: "2026-10", today: "2026-11-15" });
    const report = requests.find((r) => r.url.includes("/me/reports/spending-by-group"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-10");
    expect(requests.filter((r) => r.url.includes("/periods"))).toHaveLength(2);
  });

  it("passes a failed report on as a problem, without neighbours", async () => {
    const { api, requests } = fakeApi({
      ...periods(),
      "GET /api/v1/me/reports/spending-by-group": () => problemResponse(500, "Unknown"),
    });
    const result = await loadPersonalByGroup(api, {
      spaceId: "sp-personal",
      period: "2026-11",
      today: "2026-11-15",
    });
    expect(result.ok).toBe(false);
    expect(requests.filter((r) => r.url.includes("/periods"))).toHaveLength(0);
  });
});

describe("the By group view of the Plan tab by kind of space (ruling P200)", () => {
  const withApi = (extra: Record<string, () => Response> = {}) => {
    const fake = fakeApi({
      ...periods(),
      "GET /api/v1/me/reports/spending-by-group": () => jsonResponse(e74Groups()),
      ...extra,
    });
    server.api = fake.api;
    return fake;
  };

  it("frames the personal report with the five personal views and its note, in Spanish", async () => {
    server.spaces = [personal, householdDto()];
    withApi();
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={es} timeZone="America/Bogota">
        {await PersonalSpendingByGroupContainer({ spaceId: "sp-personal", period: "2026-11" })}
      </NextIntlClientProvider>,
    );
    const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
    expect(
      within(tabs)
        .getAllByRole("link")
        .map((a) => a.textContent),
    ).toEqual(["Mi consumo", "Próximos", "Por grupo", "Tendencia", "Líneas"]);
    expect(within(tabs).getByRole("link", { name: "Por grupo" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Mi consumo" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan?period=2026-11",
    );
    expect(within(tabs).getByRole("link", { name: "Líneas" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan/lines?period=2026-11",
    );
    expect(screen.getByText(es.reports.byGroup.personalNote)).toBeInTheDocument();
    expect(rows().map((r) => r[0])).toEqual(["Food", "Housing", "Household / Pets"]);
    // The neighbouring periods keep the person on the same view.
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/spaces/sp-personal/plan/groups?period=2026-10");
    expect(hrefs).toContain("/spaces/sp-personal/plan/groups?period=2026-12");
    // The report names no plan, so the frame shows no plan badge or link.
    expect(screen.queryByRole("link", { name: /plan$/i })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("speaks English with the same figures and the same note", async () => {
    server.spaces = [personal];
    server.locale = "en";
    withApi();
    render(
      <NextIntlClientProvider locale="en" messages={en} timeZone="America/Bogota">
        {await PersonalSpendingByGroupContainer({ spaceId: "sp-personal", period: "2026-11" })}
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.reports.byGroup.personalNote)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "By group" })).toHaveAttribute("aria-current", "page");
    expect(rows()[0]?.[0]).toBe("Food");
  });

  it("keeps the personal note neutral: tú, never voseo, and says what merges", () => {
    expect(es.reports.byGroup.personalNote).toBe(
      "Tus gastos y tu parte de los compartidos, en todos tus espacios. Los grupos que trae Hearth se unen; los que creó un espacio llevan su nombre.",
    );
    expect(en.reports.byGroup.personalNote).toBe(
      "Your expenses and your share of shared ones, across all your spaces. Hearth's own groups are merged; groups a space created carry its name.",
    );
  });

  it("chooses the personal container for a personal space and the space's for a shared one", async () => {
    server.spaces = [personal, householdDto()];
    // The home calls the container it picks (#196), so it answers with that container's own screen.
    expect(await GroupsHomeContainer({ spaceId: "sp-personal", period: "2026-11" })).toEqual(
      await PersonalSpendingByGroupContainer({ spaceId: "sp-personal", period: "2026-11" }),
    );
    expect(await GroupsHomeContainer({ spaceId: "sp-household", period: "2026-11" })).toEqual(
      await SpendingByGroupContainer({ spaceId: "sp-household", period: "2026-11" }),
    );
  });
});

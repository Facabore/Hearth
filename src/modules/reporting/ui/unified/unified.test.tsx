import { cleanup, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { e74Unified, e7Dashboard, NOVEMBER } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadUnified } from "./unified-container";
import { UnifiedView } from "./unified-view";

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));

const textOf = (name: string) => normalized(screen.getByRole("region", { name }).textContent);

describe("unified personal view (HU-E9-11)", () => {
  it("shows consumption and cash out, and Groceries of both spaces as one row", async () => {
    const { container } = renderWithIntl(<UnifiedView view={e74Unified()} formats={BUILT_IN_FORMATS} />);
    expect(textOf("Consumo")).toContain("$ 1.575.000");
    expect(textOf("Salidas")).toContain("$ 2.625.000");
    const outs = textOf("De dónde salen las salidas");
    expect(outs).toContain("Pagos de gastos$ 2.145.000");
    expect(outs).toContain("Aportes al fondo$ 480.000");
    expect(outs).not.toContain("Pagado fuera de la app");
    const groceries = screen.getAllByRole("listitem", { name: "Groceries" });
    expect(groceries).toHaveLength(1);
    expect(normalized(groceries[0]!.textContent)).toContain("$ 1.035.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lists what a guest paid as paid outside the app, and names a custom category by its space", () => {
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
    expect(textOf("De dónde salen las salidas")).toContain("Pagado fuera de la app$ 300.000");
    expect(screen.getByRole("listitem", { name: "Household / Vet" })).toBeInTheDocument();
  });

  it("lists the transfers to the person's savings among the sources, with the amount answered", () => {
    const saver = e74Unified({
      cashOut: { ...e74Unified().cashOut, savingsTransfers: cop(150_000) },
    });
    renderWithIntl(<UnifiedView view={saver} formats={BUILT_IN_FORMATS} />);
    expect(textOf("De dónde salen las salidas")).toContain("Transferencias a tus ahorros$ 150.000");
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
    expect(textOf("Consumo")).toContain("$ 7");
    expect(textOf("Consumo")).not.toContain("1.575.000");
    expect(textOf("Salidas")).toContain("$ 9");
    expect(textOf("Salidas")).not.toContain("2.625.000");
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

  it("reads the period of the personal space and the caller's own unified view", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified()),
    });
    const result = await loadUnified(api, { spaceId: "sp-personal", today: "2026-11-15" });
    expect(result.ok && result.data.view.consumption.total).toEqual(cop(1_575_000));
    const report = requests.find((r) => r.url.includes("unified-view"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-11");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/periods");
    // The neighbours are the personal space's periods around the report's own: the day before and the day after.
    const neighbours = requests
      .filter(
        (r) =>
          r.url.includes("/spaces/sp-personal/periods") &&
          new URL(r.url).searchParams.get("from") !== "2026-11-15",
      )
      .map((r) => new URL(r.url).searchParams.get("from"))
      .sort();
    expect(neighbours).toEqual(["2026-10-31", "2026-12-01"]);
    expect(result.ok && result.data.previous).toEqual(NOVEMBER);
    expect(result.ok && result.data.next).toEqual(NOVEMBER);
  });

  it("reads the period's plan of the personal space, so My spending can lead to it (#167 sibling)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified()),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(e7Dashboard({ plan: { id: "p-nov", status: "DRAFT" } })),
    });
    const result = await loadUnified(api, { spaceId: "sp-personal", today: "2026-11-15" });
    expect(result.ok && result.data.plan).toEqual({ id: "p-nov", status: "DRAFT" });
    const lines = requests.find((r) => r.url.includes("/reports/lines"))!;
    expect(new URL(lines.url).pathname).toBe("/api/v1/spaces/sp-personal/reports/lines");
    expect(new URL(lines.url).searchParams.get("period")).toBe("2026-11");
  });

  it("knows when the period has no plan, and keeps the view when the plan cannot be read", async () => {
    const reading = (lines: () => Response) =>
      fakeApi({
        "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
        "GET /api/v1/me/unified-view": () => jsonResponse(e74Unified()),
        "GET /api/v1/spaces/{spaceId}/reports/lines": lines,
      }).api;
    const none = await loadUnified(
      reading(() => jsonResponse(e7Dashboard({ plan: null }))),
      {
        spaceId: "sp-personal",
        today: "2026-11-15",
      },
    );
    expect(none.ok && none.data.plan).toBeNull();
    const unreadable = await loadUnified(
      reading(() => problemResponse(500, "Internal")),
      {
        spaceId: "sp-personal",
        today: "2026-11-15",
      },
    );
    expect(unreadable.ok && unreadable.data.view.consumption.total).toEqual(cop(1_575_000));
    expect(unreadable.ok && unreadable.data.plan).toBeUndefined();
  });

  it("asks for the period the address names, and hands back the API's refusal", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [{ ...NOVEMBER }] }),
      "GET /api/v1/me/unified-view": () => problemResponse(404, "NotFound"),
    });
    const result = await loadUnified(api, { spaceId: "sp-personal", period: "2026-09", today: "2026-11-15" });
    expect(result.ok).toBe(false);
    const report = requests.find((r) => r.url.includes("unified-view"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-09");
  });
});

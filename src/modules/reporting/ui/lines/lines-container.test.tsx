import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { meDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import {
  e7Dashboard,
  e7Fund,
  e7Groups,
  e7Matrix,
  homeTrend,
  HOUSEHOLD_MEMBERS,
  householdDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";

const served = vi.hoisted(() => ({ api: undefined as unknown }));
vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: async () => meDto(),
  getSpaces: async () => [householdDto()],
  serverApi: async () => served.api,
}));
const { LineDashboardContainer, loadLines } = await import("./lines-container");

const october = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };

describe("line dashboard container (HU-E9-10)", () => {
  it("loads today's period, its report and its neighbours", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [october] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () =>
        jsonResponse(e7Dashboard({ period: october, plan: null, lines: [] })),
    });
    const result = await loadLines(api, { spaceId: "sp-household", today: "2026-10-31" });
    expect(result.ok && result.data.dashboard.period).toEqual(october);
    const report = requests.find((r) => r.url.includes("/reports/lines"))!;
    expect(new URL(report.url).searchParams.get("period")).toBe("2026-10");
  });

  const render = async (dashboard: ReturnType<typeof e7Dashboard>) => {
    served.api = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(dashboard),
    }).api;
    renderWithIntl(await LineDashboardContainer({ spaceId: "sp-household", period: "2026-10" }));
  };

  it("shows the no-plan card, with its actions for a manager, when the period has no plan", async () => {
    await render(e7Dashboard({ period: october, plan: null, lines: [] }));
    expect(screen.getByRole("heading", { level: 2, name: "octubre 2026 no tiene plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Crear plan" })).toBeInTheDocument();
  });

  it("shows only the line dashboard when the period has a plan", async () => {
    await render(e7Dashboard({ period: october }));
    expect(screen.getByRole("region", { name: "Resumen del plan" })).toBeInTheDocument();
    expect(screen.queryByText(/no tiene plan/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Crear plan" })).toBeNull();
  });

  // Ruling P216: the desktop panels follow the line dashboard of a shared space with a plan, for its period.
  const withOverview = (dashboard: ReturnType<typeof e7Dashboard>) => {
    const fake = fakeApi({
      "GET /api/v1/spaces/{spaceId}/periods": () => jsonResponse({ items: [] }),
      "GET /api/v1/spaces/{spaceId}/reports/lines": () => jsonResponse(dashboard),
      "GET /api/v1/spaces/{spaceId}/reports/member-matrix": () => jsonResponse(e7Matrix()),
      "GET /api/v1/spaces/{spaceId}/reports/fund-contributions": () => jsonResponse(e7Fund()),
      "GET /api/v1/spaces/{spaceId}/reports/spending-by-group": () => jsonResponse(e7Groups()),
      "GET /api/v1/spaces/{spaceId}/reports/trend": () => jsonResponse(homeTrend()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
    });
    served.api = fake.api;
    return fake.requests;
  };

  it("adds the desktop overview of the dashboard's period after the line dashboard of a shared space", async () => {
    const requests = withOverview(e7Dashboard());
    renderWithIntl(await LineDashboardContainer({ spaceId: "sp-household", period: "2026-11" }));
    const table = screen.getByRole("table", { name: "Miembros por línea" });
    // The frame takes the artboard's desktop width so the panels sit in two columns.
    expect(table.closest(".lg\\:max-w-\\[1220px\\]")).not.toBeNull();
    const matrix = requests.find((r) => r.url.includes("/reports/member-matrix"))!;
    expect(new URL(matrix.url).searchParams.get("period")).toBe("2026-11");
  });

  it("reads no overview when the period has no plan", async () => {
    const requests = withOverview(e7Dashboard({ period: october, plan: null, lines: [] }));
    renderWithIntl(await LineDashboardContainer({ spaceId: "sp-household", period: "2026-10" }));
    expect(screen.queryByRole("table", { name: "Miembros por línea" })).toBeNull();
    expect(requests.some((r) => r.url.includes("/reports/member-matrix"))).toBe(false);
  });
});

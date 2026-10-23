import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, meDto, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { cashFlowDto, householdDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { CalendarContainer, daysOf, loadCashFlow } from "./calendar-container";
import { CashFlowCalendar } from "./cash-flow-calendar";

const server = vi.hoisted(() => ({ api: undefined as unknown, spaces: [] as unknown[] }));

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  redirect: vi.fn(),
}));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: async () => meDto({ timezone: "America/Bogota" }),
  getSpaces: async () => server.spaces,
  serverApi: async () => server.api,
}));

const personal = spaceDto();
const show = (flow = cashFlowDto()) =>
  renderWithIntl(<CashFlowCalendar space={personal} flow={flow} formats={BUILT_IN_FORMATS} />);
const day = (name: string) => normalized(screen.getByRole("listitem", { name }).textContent);

describe("the cash-flow calendar (#150, ruling P241 of M6c)", () => {
  it("lists each date's movements and the balance after it, as the API answers them (@golden)", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Próximos 30 días" })).toBeInTheDocument();
    const dates = within(screen.getByRole("list", { name: "Movimientos por día" }))
      .getAllByRole("listitem")
      .filter((item) => item.getAttribute("aria-labelledby"));
    expect(dates.map((item) => item.getAttribute("data-date"))).toEqual([
      "2026-10-28",
      "2026-10-30",
      "2026-11-01",
      "2026-11-05",
    ]);
    expect(day("28/10/2026")).toContain("Energía");
    expect(day("28/10/2026")).toContain("Household");
    expect(day("28/10/2026")).toContain("Pendiente desde el 20/10/2026");
    expect(day("28/10/2026")).toContain("Estimado");
    expect(day("28/10/2026")).toContain("−$ 180.000");
    expect(day("28/10/2026")).toContain("Saldo proyectado $ 1.820.000");
    expect(day("30/10/2026")).toContain("+$ 3.000.000");
    expect(day("1/11/2026")).toContain("$ 100.000");
    expect(day("1/11/2026")).toContain("No cambia tu disponible");
    expect(day("1/11/2026")).not.toContain("+$");
    const summary = normalized(screen.getByRole("region", { name: "Resumen de lo que viene" }).textContent);
    expect(summary).toContain("Disponible hoy$ 2.000.000");
    expect(summary).toContain("Entra$ 3.000.000");
    expect(summary).toContain("Sale$ 300.000");
    expect(summary).toContain("Al final$ 4.700.000");
    expect(summary).toContain("Lo más bajo: $ 1.820.000 el 28/10/2026");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("renders the API's balances, never a running sum of its own (ruling P201)", () => {
    const flow = cashFlowDto();
    flow.dates[1] = { ...flow.dates[1]!, balanceAfter: cop(7) };
    show({ ...flow, lowest: { date: "2026-11-05", balance: cop(-1) } });
    expect(day("30/10/2026")).toContain("Saldo proyectado $ 7");
    const lowest = screen.getByText(/Lo más bajo/);
    expect(normalized(lowest.textContent)).toBe("Lo más bajo: −$ 1 el 5/11/2026");
    expect(lowest).toHaveClass("text-owe-ink");
  });

  it("offers 30 and 60 days and keeps the Plan tab's views", () => {
    show();
    const window = screen.getByRole("navigation", { name: "Ventana" });
    expect(within(window).getByRole("link", { name: "30 días" })).toHaveAttribute("aria-current", "page");
    expect(within(window).getByRole("link", { name: "60 días" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan/calendar?days=60",
    );
    const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
    expect(within(tabs).getByRole("link", { name: "Próximos" })).toHaveAttribute("aria-current", "page");
    expect(within(tabs).getByRole("link", { name: "Mi consumo" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan",
    );
  });

  it("says when nothing is scheduled, and names a space in another currency once", () => {
    show(
      cashFlowDto({
        dates: [],
        otherCurrencySpaces: [{ spaceId: "sp-trip", name: "Viaje", currency: "USD" }],
      }),
    );
    expect(screen.getByText("No hay movimientos programados en los próximos 30 días.")).toBeInTheDocument();
    expect(screen.getByText("Viaje usa USD: sus movimientos no se suman aquí.")).toBeInTheDocument();
  });

  it("places a movement by its local date, never shifted by a time zone (ruling P246 of M6c)", () => {
    const flow = cashFlowDto();
    show({ ...flow, dates: [{ ...flow.dates[3]!, date: "2027-03-15" }] });
    expect(screen.getByRole("listitem", { name: "15/3/2027" })).toHaveAttribute("data-date", "2027-03-15");
  });

  it("offers no action that records money: it only shows what is coming (ruling P247 of M6c)", () => {
    const { container } = show();
    expect(screen.queryAllByRole("button")).toEqual([]);
    expect(container.querySelector("form")).toBeNull();
  });

  it("asks for the window it is given, 30 days unless 60 is asked for", async () => {
    expect([daysOf(undefined), daysOf("60"), daysOf("45")]).toEqual([30, 60, 30]);
    const { api, requests } = fakeApi({
      "GET /api/v1/me/cash-flow": () => jsonResponse(cashFlowDto({ days: 60 })),
    });
    const result = await loadCashFlow(api, 60);
    expect(result.ok && result.data.days).toBe(60);
    expect(new URL(requests[0]!.url).searchParams.get("days")).toBe("60");
  });
});

describe("the calendar's container (ruling P241 of M6c)", () => {
  it("shows the personal space's next 60 days when `?days=60` asks for them", async () => {
    server.spaces = [personal, householdDto()];
    const { api, requests } = fakeApi({
      "GET /api/v1/me/cash-flow": () => jsonResponse(cashFlowDto({ days: 60 })),
    });
    server.api = api;
    renderWithIntl(await CalendarContainer({ spaceId: "sp-personal", days: "60" }));
    expect(screen.getByRole("heading", { level: 1, name: "Próximos 60 días" })).toBeInTheDocument();
    expect(new URL(requests[0]!.url).searchParams.get("days")).toBe("60");
  });

  it("has no calendar for a shared space, and asks for nothing", async () => {
    server.spaces = [personal, householdDto()];
    const { api, requests } = fakeApi({ "GET /api/v1/me/cash-flow": () => jsonResponse(cashFlowDto()) });
    server.api = api;
    await expect(CalendarContainer({ spaceId: "sp-household" })).rejects.toThrow("not found");
    expect(requests).toEqual([]);
  });

  it("says what failed when the API refuses", async () => {
    server.spaces = [personal];
    const { api } = fakeApi({ "GET /api/v1/me/cash-flow": () => problemResponse(422, "ValidationFailed") });
    server.api = api;
    renderWithIntl(await CalendarContainer({ spaceId: "sp-personal" }));
    expect(screen.queryByRole("list", { name: "Movimientos por día" })).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

import { screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { cashFlowDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { CashFlowCalendar } from "./cash-flow-calendar";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  redirect: vi.fn(),
}));

const personal = spaceDto();
const show = (flow = cashFlowDto()) =>
  renderWithIntl(<CashFlowCalendar space={personal} flow={flow} formats={BUILT_IN_FORMATS} />);
const day = (name: string) => normalized(screen.getByRole("listitem", { name }).textContent);

describe("the cash-flow calendar (#150, ruling P241 of M6c)", () => {
  it("is a stacked screen titled Plan whose way back is the space's Configuración (ruling P311)", () => {
    show();
    expect(screen.getByRole("heading", { level: 1, name: "Plan" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/settings",
    );
  });

  it("lists each date's movements and the balance after it, as the API answers them (@golden)", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 2, name: "Próximos 30 días" })).toBeInTheDocument();
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
    expect(within(tabs).getByRole("link", { name: "Rubros" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plan",
    );
    // As every Plan view (P270's board): the views under the header, then this view's own window.
    expect(tabs.compareDocumentPosition(window) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it("offers to add a recurring movement when nothing is scheduled (HU-E9-09, ruling P270, #178 item 4)", async () => {
    const { container } = show(cashFlowDto({ dates: [] }));
    expect(
      screen.getByText("Programa tu arriendo, tus servicios o tu salario y aquí verás cómo queda tu saldo."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Agregar un movimiento recurrente" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/recurrences/new",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no zero summary when nothing is scheduled, only the empty card (board 11, ruling P272)", () => {
    show(cashFlowDto({ dates: [] }));
    expect(screen.queryByRole("region", { name: "Resumen de lo que viene" })).toBeNull();
    expect(screen.queryByText(/Disponible hoy|Lo más bajo/)).toBeNull();
  });

  it("orders the view as its board: the tabs, the title, what it lists, then the window (ruling P272)", () => {
    show(cashFlowDto({ dates: [] }));
    const tabs = screen.getByRole("navigation", { name: "Vistas del plan" });
    const title = screen.getByRole("heading", { level: 2, name: "Próximos 30 días" });
    const explain = screen.getByText(/Los movimientos recurrentes de tus cuentas/);
    const window = screen.getByRole("navigation", { name: "Ventana" });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect([follows(tabs, title), follows(title, explain), follows(explain, window)]).toEqual([
      true,
      true,
      true,
    ]);
    // No line with the space's name above the title.
    expect(screen.queryByText(personal.name)).toBeNull();
    expect(within(window).getByRole("link", { name: "30 días" })).toHaveClass("bg-ink");
    expect(within(window).getByRole("link", { name: "60 días" })).not.toHaveClass("bg-ink");
  });

  it("offers no link to add one while something is scheduled", () => {
    show();
    expect(screen.queryByRole("link", { name: "Agregar un movimiento recurrente" })).not.toBeInTheDocument();
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
});

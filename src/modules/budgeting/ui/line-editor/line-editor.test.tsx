import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, categoryDto, cop, groupDto, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  HOUSEHOLD_MEMBERS,
  householdDto,
  planLineDto,
  referencePlanDto,
  savingsAccountDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { CategoryGroupDto, PlanLineDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadLineEditor } from "./line-editor-container";
import { LineEditor } from "./line-editor";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const ADD = "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines";
const empty = referencePlanDto({ lines: [], planned: cop(0), unallocated: cop(4_000_000) });
const show = (
  line: PlanLineDto | null,
  api?: Api,
  plan = line ? referencePlanDto() : empty,
  groups: CategoryGroupDto[] = [],
) =>
  renderWithIntl(
    <LineEditor
      space={householdDto()}
      plan={plan}
      line={line}
      savingsAccounts={[savingsAccountDto()]}
      groups={groups}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
      api={api}
    />,
  );
const added = () => jsonResponse(referencePlanDto({ version: 8 }), 201);

describe("line editor (HU-E9-08)", () => {
  it("shows the carry-over among the figures and explains the chosen rollover mode (#143, rulings P231 and P232)", async () => {
    const { container } = show(
      planLineDto({
        rolloverMode: "ROLLOVER",
        carryOver: cop(200_000),
        available: cop(1_670_000),
        carryOverFrom: {
          planId: "p-oct",
          period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
          closed: true,
        },
      }),
    );
    const figures = normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent);
    expect(figures).toContain("Arrastrado+$ 200.000 de octubre 2026");
    await userEvent.click(screen.getByRole("radio", { name: "Reinicia" }));
    const modes = screen.getByRole("radiogroup", { name: "Al cambiar de período" });
    expect(modes).toHaveAccessibleDescription("Cada período empieza en cero.");
    await userEvent.click(screen.getByRole("radio", { name: "Acumula" }));
    expect(modes).toHaveAccessibleDescription(
      "Lo que sobra pasa al siguiente período y no cuenta contra la capacidad. Úsalo para ahorrar cada mes para un gasto anual, como el SOAT, el predial o un seguro. Pasa cuando el plan siguiente se crea como copia de este y este se cierra.",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Ajusta" }));
    expect(modes).toHaveAccessibleDescription(
      "Si te pasas, lo que excede se descuenta del siguiente período; lo que sobra no pasa. Pasa cuando el plan siguiente se crea como copia de este y este se cierra.",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names the plan a carry waits for when its source is not closed (ruling P243 of M6c)", () => {
    show(
      planLineDto({
        rolloverMode: "ROLLOVER",
        carryOverFrom: {
          planId: "p-oct",
          period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
          closed: false,
        },
      }),
    );
    expect(normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent)).toContain(
      "ArrastradoSe arrastra de octubre 2026 cuando ese plan se cierre.",
    );
  });

  it("shows no carry-over figure when the line carries nothing", () => {
    show(planLineDto());
    expect(screen.getByRole("region", { name: "Cifras de la línea" }).textContent).not.toContain(
      "Arrastrado",
    );
  });

  it("adds Rent funded by the shared fund with rollover RESET (@golden)", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    const { container } = show(null, api);
    expect(screen.getByRole("heading", { level: 1, name: "Nueva línea" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nombre"), "Rent");
    await userEvent.type(screen.getByLabelText("Planeado"), "1.200.000");
    await userEvent.click(screen.getByRole("radio", { name: "Fondo compartido" }));
    expect(screen.getByRole("radio", { name: "Reinicia" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toEqual({
      name: "Rent",
      plannedAmount: { amount: "120000000", currency: "COP" },
      funding: "SHARED_FUND",
      rolloverMode: "RESET",
      isCatchAll: false,
      savingsAccountIds: [],
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows the planned amount's format after its hint, drops a letter and still adds the line (#164)", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    show(null, api);
    const planned = screen.getByLabelText("Planeado");
    expect(planned).toHaveAccessibleDescription(/Ej: 1\.250,50$/);
    await userEvent.type(screen.getByLabelText("Nombre"), "Rent");
    await userEvent.type(planned, "1200b000");
    expect(planned).toHaveValue("1.200.000");
    await userEvent.click(screen.getByRole("radio", { name: "Fondo compartido" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toMatchObject({
      name: "Rent",
      plannedAmount: { amount: "120000000", currency: "COP" },
    });
  });

  it("adds Savings with the savings account the person owns, never as the catch-all", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Savings");
    await userEvent.type(screen.getByLabelText("Planeado"), "600.000");
    await userEvent.click(screen.getByRole("radio", { name: "Ahorro" }));
    expect(screen.queryByRole("switch", { name: "Todo lo demás" })).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: "Ahorros" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toMatchObject({
      funding: "SAVINGS",
      isCatchAll: false,
      savingsAccountIds: ["a-savings"],
    });
  });

  it("marks Free as the catch-all line", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Free");
    await userEvent.type(screen.getByLabelText("Planeado"), "730.000");
    await userEvent.click(screen.getByRole("switch", { name: "Todo lo demás" }));
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await requests[0]!.json()).toMatchObject({ name: "Free", isCatchAll: true });
  });

  it("shows Home's figures and patches only its planned amount", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(planLineDto({ spent: cop(1_300_000), available: cop(170_000) }), api);
    const figures = normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent);
    expect(figures).toContain("Planeado$ 1.470.000");
    expect(figures).toContain("Gastado$ 1.300.000");
    expect(figures).toContain("Disponible$ 170.000");
    expect(screen.getByText("36,75 % de la capacidad · sin asignar $ 0")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Planeado"));
    await userEvent.type(screen.getByLabelText("Planeado"), "1.500.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(await requests[0]!.json()).toEqual({ plannedAmount: { amount: "150000000", currency: "COP" } });
  });

  it("shows a taken name next to the name field and stays", async () => {
    const { api } = fakeApi({ [ADD]: () => problemResponse(409, "BudgetLineNameTaken") });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Home");
    await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    await waitFor(() => expect(screen.getByLabelText("Nombre")).toHaveAttribute("aria-invalid", "true"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("removes a line after its confirmation", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(planLineDto({ id: "l-free", name: "Free" }), api);
    await userEvent.click(screen.getByRole("button", { name: "Quitar línea" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Quitar Free?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov"));
    expect(requests[0]!.method).toBe("DELETE");
  });

  it("keeps another member's savings account on the line until it is unchecked (ruling P213)", async () => {
    const PATCH = "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}";
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse(referencePlanDto({ version: 8 })) });
    show(planLineDto({ funding: "SAVINGS", savingsAccountIds: ["a-juan"] }), api);
    expect(screen.getByRole("group", { name: "Cuentas de ahorro" })).toBeInTheDocument();
    const other = screen.getByRole("checkbox", { name: "Cuenta de ahorro de otro miembro" });
    expect(other).toBeChecked();
    await userEvent.click(screen.getByRole("checkbox", { name: "Ahorros" }));
    await userEvent.click(other);
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(await requests[0]!.json()).toEqual({ savingsAccountIds: ["a-savings"] });
  });

  it("sends nothing about the accounts of a savings line that did not change them", async () => {
    const PATCH = "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}";
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse(referencePlanDto({ version: 8 })) });
    show(planLineDto({ funding: "SAVINGS", savingsAccountIds: ["a-juan"], rolloverMode: "RESET" }), api);
    await userEvent.click(screen.getByRole("radio", { name: "Acumula" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(await requests[0]!.json()).toEqual({ rolloverMode: "ROLLOVER" });
  });

  it("changes what happens when the period changes", async () => {
    const PATCH = "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}";
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse(referencePlanDto({ version: 8 })) });
    show(planLineDto(), api);
    expect(screen.getByRole("radio", { name: "Reinicia" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Ajusta" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(await requests[0]!.json()).toEqual({ rolloverMode: "ADJUSTED" });
  });

  it("says when the person has no savings account in the plan's currency", async () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <LineEditor
        space={householdDto()}
        plan={empty}
        line={null}
        savingsAccounts={[]}
        groups={[]}
        members={HOUSEHOLD_MEMBERS}
        formats={BUILT_IN_FORMATS}
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Ahorro" }));
    expect(screen.getByText("No tienes cuentas de ahorro en COP. Crea una en Cuentas.")).toBeInTheDocument();
  });

  it("asks for a readable amount and sends nothing", async () => {
    const { api, requests } = fakeApi({ [ADD]: added });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
    await userEvent.type(screen.getByLabelText("Planeado"), "mucho");
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(screen.getByText("Escribe un monto como 1.500.000.")).toBeInTheDocument();
    expect(screen.getByLabelText("Planeado")).toHaveAttribute("aria-invalid", "true");
    expect(requests).toHaveLength(0);
  });

  it("shows an amount over capacity next to the planned field", async () => {
    const { api } = fakeApi({ [ADD]: () => problemResponse(422, "PlanExceedsCapacity") });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
    await userEvent.type(screen.getByLabelText("Planeado"), "9.000.000");
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    await waitFor(() => expect(screen.getByLabelText("Planeado")).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getByLabelText("Nombre")).not.toHaveAttribute("aria-invalid");
  });

  it("shows a refusal that names no field above the button", async () => {
    const { api } = fakeApi({ [ADD]: () => problemResponse(409, "PeriodClosed") });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
    await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).not.toHaveAttribute("aria-invalid");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("says when someone else changed the plan, reads it again and keeps the draft (ruling P206)", async () => {
    const reread = vi.fn(() => jsonResponse(referencePlanDto({ version: 9 })));
    const { api, requests } = fakeApi({
      [ADD]: () => problemResponse(412, "PreconditionFailed"),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": reread,
    });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
    await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await waitFor(() => expect(reread).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Nombre")).toHaveValue("Pets");
    // The next attempt carries the version that was read again.
    await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
    const adds = () => requests.filter((request) => request.method === "POST");
    await waitFor(() => expect(adds()).toHaveLength(2));
    expect(adds().map((request) => request.headers.get("if-match"))).toEqual(['"7"', '"9"']);
  });

  it("disables the button while saving and sends once", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, requests } = fakeApi({
      [ADD]: async () => {
        await gate;
        return added();
      },
    });
    show(null, api);
    await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
    await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
    const button = screen.getByRole("button", { name: "Agregar línea" });
    // Two submits before React re-renders: only the guard, not the disabled button, can stop the second.
    act(() => {
      const form = button.closest("form")!;
      form.requestSubmit();
      form.requestSubmit();
    });
    await waitFor(() => expect(button).toBeDisabled());
    release();
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);
  });

  it("keeps the sheet open and says why when a removal is refused", async () => {
    const { api } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        problemResponse(409, "PeriodClosed"),
    });
    show(planLineDto({ id: "l-free", name: "Free" }), api);
    await userEvent.click(screen.getByRole("button", { name: "Quitar línea" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Quitar Free?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar" }));
    expect(await within(sheet).findByRole("alert")).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("offers no removal and no figures for a new line", async () => {
    show(null);
    expect(screen.queryByRole("button", { name: "Quitar línea" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Cifras de la línea" })).toBeNull();
    expect(screen.getByText("Sin asignar: $ 4.000.000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov",
    );
  });

  it("offers only the caller's active savings accounts in the plan's currency (ruling P213)", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(referencePlanDto()),
      "GET /api/v1/spaces/{spaceId}/categories": () => jsonResponse({ items: [] }),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/accounts": () =>
        jsonResponse({
          items: [
            savingsAccountDto(),
            accountDto({ id: "a-bank", name: "Bancolombia" }),
            accountDto({
              id: "a-old",
              name: "Old savings",
              type: "SAVINGS",
              archivedAt: "2026-10-01T12:00:00.000Z",
            }),
            accountDto({
              id: "a-usd",
              name: "Dollars",
              type: "SAVINGS",
              balance: { amount: "0", currency: "USD" },
            }),
          ],
          totals: { available: cop(0), netWorth: cop(0) },
        }),
    });
    const result = await loadLineEditor(api, {
      spaceId: "sp-household",
      planId: "p-nov",
      lineId: "l-home",
      personalSpaceId: "sp-personal",
    });
    expect(
      result.ok && [
        result.data.line?.name,
        result.data.savingsAccounts.map((a) => a.name),
        result.data.members.map((m) => m.displayName),
      ],
    ).toEqual(["Home", ["Ahorros"], ["Ana", "Juan"]]);
  });

  it("leaves Free unallocated: its figures stay, its member rows go, and the save sends NONE", async () => {
    const { api, requests } = fakeApi({
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () =>
        jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(
      planLineDto({
        id: "l-free",
        name: "Free",
        plannedAmount: cop(730_000),
        spent: cop(250_000),
        available: cop(480_000),
        capacityShare: "18.25",
      }),
      api,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Sin asignar" }));
    expect(screen.queryByRole("group", { name: "Ana" })).toBeNull();
    const figures = normalized(screen.getByRole("region", { name: "Cifras de la línea" }).textContent);
    expect(figures).toContain("Planeado$ 730.000");
    expect(figures).toContain("Gastado$ 250.000");
    expect(figures).toContain("Disponible$ 480.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
      "/api/v1/spaces/sp-household/plans/p-nov/lines/l-free/allocation",
    ]);
    expect(await requests[0]!.json()).toEqual({ rule: "NONE" });
  });

  it("blocks the save while the percentages do not add up to 100 %", async () => {
    const { api, requests } = fakeApi({});
    show(planLineDto({ id: "l-free", name: "Free", plannedAmount: cop(730_000) }), api);
    // A changed name would be sent by the line step: nothing at all goes out while the allocation does not hold.
    await userEvent.clear(screen.getByLabelText("Nombre"));
    await userEvent.type(screen.getByLabelText("Nombre"), "Libre");
    await userEvent.click(screen.getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(screen.getByLabelText("Valor de Ana"), "42");
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "57");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    expect(screen.getByRole("alert")).toHaveTextContent("El reparto de esta línea no cuadra.");
    expect(screen.getByRole("region", { name: "Quién responde por la línea" })).toHaveFocus();
    expect(requests).toHaveLength(0);
  });

  it("shows a stored percentage allocation as typed and sends it only when a value changes", async () => {
    const member = (memberId: string, percent: string) => ({
      memberId,
      percent,
      amount: null,
      assigned: cop(0),
    });
    const stored = planLineDto({
      id: "l-free",
      name: "Free",
      plannedAmount: cop(730_000),
      allocation: {
        rule: "PERCENT",
        members: [member("m-ana", "42.00"), member("m-juan", "58.00")],
        error: null,
      },
    });
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}": () =>
        jsonResponse(referencePlanDto({ version: 8 })),
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () =>
        jsonResponse(referencePlanDto({ version: 9 })),
    });
    show(stored, api);
    expect(screen.getByLabelText("Valor de Ana")).toHaveValue("42");
    expect(screen.getByLabelText("Valor de Juan")).toHaveValue("58");
    await userEvent.click(screen.getByRole("radio", { name: "Ajusta" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(requests.map((r) => r.method)).toEqual(["PATCH"]);
  });

  it("sends a percentage allocation whose value changed, to the cent of the percent", async () => {
    const member = (memberId: string, percent: string) => ({
      memberId,
      percent,
      amount: null,
      assigned: cop(0),
    });
    const { api, requests } = fakeApi({
      "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () =>
        jsonResponse(referencePlanDto({ version: 8 })),
    });
    show(
      planLineDto({
        id: "l-free",
        name: "Free",
        plannedAmount: cop(730_000),
        allocation: {
          rule: "PERCENT",
          members: [member("m-ana", "42.00"), member("m-juan", "58.00")],
          error: null,
        },
      }),
      api,
    );
    await userEvent.clear(screen.getByLabelText("Valor de Ana"));
    await userEvent.type(screen.getByLabelText("Valor de Ana"), "40");
    await userEvent.clear(screen.getByLabelText("Valor de Juan"));
    await userEvent.type(screen.getByLabelText("Valor de Juan"), "60");
    await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(await requests[0]!.json()).toEqual({
      rule: "PERCENT",
      members: [
        { memberId: "m-ana", percent: "40" },
        { memberId: "m-juan", percent: "60" },
      ],
    });
  });

  describe("categories (ruling P212)", () => {
    const CATEGORIES = "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories";
    const PATCH = "PATCH /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}";
    const food = [
      groupDto({
        categories: [
          categoryDto({ id: "c-groceries", name: "Groceries" }),
          categoryDto({ id: "c-utilities", name: "Utilities" }),
        ],
      }),
    ];
    const choose = async (...names: string[]) => {
      await userEvent.click(screen.getByRole("button", { name: "Elegir categorías" }));
      const sheet = await screen.findByRole("dialog");
      for (const name of names) await userEvent.click(within(sheet).getByRole("checkbox", { name }));
      await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    };

    it("maps the chosen categories after adding the line, with the version the add answered", async () => {
      const { api, requests } = fakeApi({
        [ADD]: added,
        [CATEGORIES]: () => jsonResponse(referencePlanDto({ version: 9 })),
      });
      show(null, api, empty, food);
      expect(screen.getByText("Ninguna categoría todavía")).toBeInTheDocument();
      await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
      await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
      await choose("Groceries");
      expect(within(screen.getByRole("list", { name: "Categorías" })).getByText("Groceries")).toBeVisible();
      await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
      await waitFor(() => expect(requests).toHaveLength(2));
      expect(requests.map((r) => [r.method, r.headers.get("if-match")])).toEqual([
        ["POST", '"7"'],
        ["PUT", '"8"'],
      ]);
      expect(await requests[1]!.json()).toEqual({ categoryIds: ["c-groceries"] });
    });

    it("sends categories only when the set changed, and replaces them as chosen", async () => {
      const { api, requests } = fakeApi({
        [PATCH]: () => jsonResponse(referencePlanDto({ version: 8 })),
        [CATEGORIES]: () => jsonResponse(referencePlanDto({ version: 9 })),
      });
      show(planLineDto({ categoryIds: ["c-groceries"] }), api, referencePlanDto(), food);
      expect(within(screen.getByRole("list", { name: "Categorías" })).getByText("Groceries")).toBeVisible();
      await userEvent.click(screen.getByRole("radio", { name: "Ajusta" }));
      await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(requests.map((r) => r.method)).toEqual(["PATCH"]);
    });

    it("replaces the mapped categories with the ones chosen in the sheet", async () => {
      const { api, requests } = fakeApi({
        [CATEGORIES]: () => jsonResponse(referencePlanDto({ version: 8 })),
      });
      show(planLineDto({ categoryIds: ["c-groceries"] }), api, referencePlanDto(), food);
      await choose("Groceries", "Utilities");
      await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(requests.map((r) => new URL(r.url).pathname)).toEqual([
        "/api/v1/spaces/sp-household/plans/p-nov/lines/l-home/categories",
      ]);
      expect(await requests[0]!.json()).toEqual({ categoryIds: ["c-utilities"] });
    });

    it("sends no categories when a line is turned into a savings line after choosing some", async () => {
      const { api, requests } = fakeApi({ [ADD]: added });
      show(null, api, empty, food);
      await userEvent.type(screen.getByLabelText("Nombre"), "Nest egg");
      await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
      await choose("Groceries");
      await userEvent.click(screen.getByRole("radio", { name: "Ahorro" }));
      await userEvent.click(screen.getByRole("checkbox", { name: "Ahorros" }));
      await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(requests.map((r) => r.method)).toEqual(["POST"]);
    });

    it("offers a savings line no categories", () => {
      show(planLineDto({ funding: "SAVINGS" }), undefined, referencePlanDto(), food);
      expect(screen.queryByRole("button", { name: "Elegir categorías" })).toBeNull();
    });

    it("keeps the line it added when its categories are refused, and retries on it instead of adding twice", async () => {
      let attempts = 0;
      const pets = planLineDto({ id: "l-pets", name: "Pets", plannedAmount: cop(100_000) });
      const { api, requests } = fakeApi({
        [ADD]: () => jsonResponse(referencePlanDto({ version: 8, lines: [pets] }), 201),
        [CATEGORIES]: () =>
          ++attempts === 1
            ? problemResponse(409, "CategoryAlreadyMapped")
            : jsonResponse(referencePlanDto({ version: 9 })),
      });
      show(null, api, empty, food);
      await userEvent.type(screen.getByLabelText("Nombre"), "Pets");
      await userEvent.type(screen.getByLabelText("Planeado"), "100.000");
      await choose("Groceries");
      await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
      expect(await screen.findByText("Esa categoría ya está en otra línea del plan.")).toBeVisible();
      expect(router.push).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "Agregar línea" }));
      await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
      expect(requests.map((r) => [r.method, new URL(r.url).pathname.split("/").slice(-2).join("/")])).toEqual(
        [
          ["POST", "p-nov/lines"],
          ["PUT", "l-pets/categories"],
          ["PUT", "l-pets/categories"],
        ],
      );
      expect(requests[2]!.headers.get("if-match")).toBe('"8"');
    });

    it("shows a refused allocation in its section and stays", async () => {
      const { api } = fakeApi({
        "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/allocation": () =>
          problemResponse(422, "InvalidAllocation"),
      });
      show(planLineDto(), api);
      await userEvent.click(screen.getByRole("radio", { name: "Sin asignar" }));
      await userEvent.click(screen.getByRole("button", { name: "Guardar línea" }));
      expect(await screen.findByText(/El reparto de esta línea no cuadra/)).toBeVisible();
      expect(router.push).not.toHaveBeenCalled();
    });
  });
});

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  householdDto,
  planLineDto,
  referencePlanDto,
  savingsAccountDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { PlanLineDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { loadLineEditor } from "./line-editor-container";
import { LineEditor } from "./line-editor";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const ADD = "POST /api/v1/spaces/{spaceId}/plans/{planId}/lines";
const empty = referencePlanDto({ lines: [], planned: cop(0), unallocated: cop(4_000_000) });
const show = (line: PlanLineDto | null, api?: Api, plan = line ? referencePlanDto() : empty) =>
  renderWithIntl(
    <LineEditor
      space={householdDto()}
      plan={plan}
      line={line}
      savingsAccounts={[savingsAccountDto()]}
      formats={BUILT_IN_FORMATS}
      api={api}
    />,
  );
const added = () => jsonResponse(referencePlanDto({ version: 8 }), 201);

describe("line editor (HU-E9-08)", () => {
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
    expect(result.ok && [result.data.line?.name, result.data.savingsAccounts.map((a) => a.name)]).toEqual([
      "Home",
      ["Ahorros"],
    ]);
  });
});

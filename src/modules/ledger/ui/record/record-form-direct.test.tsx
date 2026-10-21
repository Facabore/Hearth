import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { Person } from "../direct/counterparts";
import { RecordForm, type RecordFormProps } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  key: "groceries",
  subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
});
const mine = categoryDto({ id: "c-mine", name: "Mine", key: null });
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries, mine] })];
const accounts = [accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" })];
const PEOPLE: Person[] = [
  { memberId: "m-juan-d", name: "Juan", isGuest: false, directSpace: "Ana & Juan" },
  { memberId: "m-luis", name: "Luis", isGuest: false, directSpace: null },
  { memberId: "m-carlos", name: "Carlos", isGuest: true, directSpace: "Ana & Carlos" },
];
const form = (api: Api, extra: Partial<RecordFormProps> = {}) =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      people={PEOPLE}
      api={api}
      {...extra}
    />,
  );
const created = (spaceId: string, made = false) =>
  jsonResponse({ spaceId, created: made, expense: { ...transactionDto({ id: "t-1" }), warnings: [] } }, 201);
const chooseGroceries = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
};
const openSheet = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Dividir con alguien" }));
  // The sheet is imported lazily on first open: wait for it rather than racing the chunk.
  return screen.findByRole("dialog", { name: "Dividir con alguien" });
};
const splitWith = async (name: string) => {
  await openSheet();
  await userEvent.click(screen.getByRole("radio", { name: new RegExp(name) }));
  await userEvent.click(screen.getByRole("button", { name: `Seguir con ${name}` }));
};

describe("split with someone from Personal (HU-E9-06, ruling P172)", () => {
  it("splits a dinner with Juan through their direct space and opens its list", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-ana-juan") });
    const { container } = form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "120000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Cena");
    await chooseGroceries();
    const sheet = await openSheet();
    expect(within(sheet).getByText("Ya tienen «Ana & Juan»: se usa ese")).toBeInTheDocument();
    expect(within(sheet).getByText("Se crea un espacio para los dos")).toBeInTheDocument();
    expect(within(sheet).getByText("De «Ana & Carlos»")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    expect(within(sheet).getByRole("button", { name: /^Seguir con/ })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Juan/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Seguir con Juan" }));
    expect(screen.getByText("Con Juan · mitad y mitad")).toBeInTheDocument();
    await userEvent.dblClick(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await requests[0]!.json();
    expect(body).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-juan-d" },
      categoryKey: "groceries",
      accountId: "a-bank",
      amount: { amount: "12000000", currency: "COP" },
      description: "Cena",
    });
    expect(body).not.toHaveProperty("categoryId");
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-ana-juan/transactions");
    expect(router.refresh).toHaveBeenCalled();
  });

  it("splits with a new guest typed by name", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-new", true) });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await chooseGroceries();
    await openSheet();
    expect(screen.getByRole("button", { name: "Usar" })).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Nombre del nuevo invitado"), "Marta");
    await userEvent.click(screen.getByRole("button", { name: "Usar" }));
    expect(screen.getByText("Con Marta · mitad y mitad")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect((await requests[0]!.json()).counterpart).toEqual({ kind: "GUEST", displayName: "Marta" });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-new/transactions");
  });

  it("refuses a category of the person's own, and the split can be removed", async () => {
    const { api, requests } = fakeApi({});
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Mine" }));
    await splitWith("Luis");
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveAccessibleDescription(
      "Esta categoría es solo de tu espacio Personal. Elige una categoría predeterminada para dividir el gasto.",
    );
    expect(requests).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Quitar la división con Luis" }));
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dividir con alguien" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Categoría/ })).not.toHaveAccessibleDescription(/Personal/);
  });

  it("asks for a category instead of blaming a missing one on the catalog", async () => {
    const { api, requests } = fakeApi({});
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await splitWith("Luis");
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveAccessibleDescription(
      "Elige una categoría.",
    );
    expect(requests).toHaveLength(0);
  });

  it("shows an API problem in the form and keeps the same key for a retry of the same draft", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/direct-splits": () =>
        calls++ === 0 ? problemResponse(422, "InvalidDirectCounterpart") : created("sp-ana-juan"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await chooseGroceries();
    await splitWith("Luis");
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get("idempotency-key")).toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("takes a new key when someone else is chosen", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/direct-splits": () => problemResponse(500, "InternalError"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await chooseGroceries();
    await splitWith("Juan");
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Quitar la división con Juan" }));
    await splitWith("Luis");
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    await screen.findByRole("alert");
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get("idempotency-key")).not.toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("offers the split only on an expense", async () => {
    form(fakeApi({}).api);
    expect(screen.getByRole("button", { name: "Dividir con alguien" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Ingreso" }));
    expect(screen.queryByRole("button", { name: "Dividir con alguien" })).not.toBeInTheDocument();
  });

  it("does not offer it in a shared space even when it is given people", () => {
    form(fakeApi({}).api, { space: householdSpace() });
    expect(screen.queryByRole("button", { name: "Dividir con alguien" })).not.toBeInTheDocument();
  });

  it("does not offer it without the list of people", () => {
    form(fakeApi({}).api, { people: undefined });
    expect(screen.queryByRole("button", { name: "Dividir con alguien" })).not.toBeInTheDocument();
  });
});

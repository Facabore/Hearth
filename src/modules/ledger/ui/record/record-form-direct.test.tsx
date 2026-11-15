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
  await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
  await userEvent.click(await screen.findByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("radio", { name: "Sin subcategoría" }));
};
// P333 (board "Registrar: una fila"): who paid and whom it was for are one row, under the category.
const WHO_ROW = /Quién pagó y para quién/;
const whoRow = () => screen.getByRole("button", { name: WHO_ROW });
const openWho = async () => {
  await userEvent.click(whoRow());
  // The sheet is imported lazily on first open: wait for it rather than racing the chunk.
  return screen.findByRole("dialog", { name: "¿Quién pagó y para quién?" });
};
/** A person's checkbox; its name reads the person, then their line ("Te debe"). */
const person = (sheet: HTMLElement, name: string) =>
  within(sheet).getByRole("checkbox", { name: new RegExp(`^${name}`) });
const lineOf = (sheet: HTMLElement, name: string) =>
  person(sheet, name).getAttribute("aria-describedby")
    ? (document.getElementById(person(sheet, name).getAttribute("aria-describedby")!)?.textContent ?? "")
    : "";
const tick = async (...names: string[]) => {
  const sheet = await openWho();
  for (const name of names) await userEvent.click(person(sheet, name));
  await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
};
const dinner = async (pesos = "120000") => {
  await userEvent.type(screen.getByLabelText("Monto"), pesos);
  await chooseGroceries();
};
const save = () => userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
const posted = async (requests: Request[]) => (await requests[0]!.json()) as Record<string, unknown>;
const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });

describe("one row says who paid and whom it was for (P333, P331)", () => {
  it("reads Pagaste tú con Bancolombia under the category, and its sheet starts with Tú alone", async () => {
    const { container } = form(fakeApi({}).api);
    const row = whoRow();
    const tiles = screen.getByRole("group", { name: "Categoría" });
    expect(tiles.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row).toHaveClass("border-b", "min-h-11");
    expect(row).toHaveTextContent("Pagaste tú con Bancolombia");
    expect(screen.queryByRole("button", { name: /^Cuenta/ })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
    const sheet = await openWho();
    const payers = within(within(sheet).getByRole("radiogroup", { name: "Pagó" })).getAllByRole("radio");
    expect(payers.map((radio) => radio.textContent)).toEqual(["Tú"]);
    expect(within(sheet).getByRole("radiogroup", { name: "Desde" })).toBeInTheDocument();
    expect(person(sheet, "Tú")).toBeChecked();
    expect(lineOf(sheet, "Tú")).toBe("Tu parte");
    expect(lineOf(sheet, "Juan")).toBe("No le toca nada");
    expect(within(sheet).getByRole("radiogroup", { name: "Cómo se divide" })).toBeInTheDocument();
    expect(
      within(sheet).getByText(
        "Cada deuda queda en tu espacio con esa persona y en Saldos. Si alguien no usa Hearth, se agrega como invitado.",
      ),
    ).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("keeps half and half with Juan as before: one direct split with no parts (HU-E1-13)", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-ana-juan") });
    form(api);
    await userEvent.type(screen.getByLabelText("Descripción"), "Cena");
    await dinner();
    await tick("Juan");
    expect(whoRow()).toHaveTextContent("Pagaste tú con Bancolombia · para ti y Juan");
    await userEvent.dblClick(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    const body = await posted(requests);
    expect(body).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-juan-d" },
      categoryKey: "groceries",
      accountId: "a-bank",
      amount: cop(120_000),
      description: "Cena",
    });
    expect(body).not.toHaveProperty("categoryId");
    expect(body).not.toHaveProperty("parts");
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-ana-juan/transactions", { scroll: false });
  });

  it("records it all for Juan when Tú is not ticked: he owes the whole amount", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-ana-juan") });
    form(api);
    await dinner();
    const sheet = await openWho();
    await userEvent.click(person(sheet, "Tú"));
    await userEvent.click(person(sheet, "Juan"));
    expect(lineOf(sheet, "Tú")).toBe("No te toca nada");
    expect(lineOf(sheet, "Juan")).toBe("Te debe");
    expect(person(sheet, "Juan").closest("li")).toHaveTextContent("$ 120.000");
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(whoRow()).toHaveTextContent("Pagaste tú con Bancolombia · para Juan");
    await save();
    expect(await posted(requests)).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-juan-d" },
      parts: { mine: cop(0), theirs: cop(120_000) },
    });
  });

  it("splits for Juan and Luis without Tú, each part with its person", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-ana-juan") });
    form(api);
    await dinner("150000");
    await tick("Tú", "Juan", "Luis");
    expect(whoRow()).toHaveTextContent("Pagaste tú con Bancolombia · para Juan y Luis");
    await save();
    expect(await posted(requests)).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-juan-d" },
      parts: {
        mine: cop(0),
        theirs: cop(75_000),
        others: [{ counterpart: { kind: "MEMBER", memberId: "m-luis" }, amount: cop(75_000) }],
      },
    });
  });

  it("sends the typed Montos, Tú 50,000 and the guest Carlos 70,000", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-ana-carlos") });
    form(api);
    await dinner();
    const sheet = await openWho();
    await userEvent.click(person(sheet, "Carlos"));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Montos" }));
    await userEvent.type(within(sheet).getByLabelText("Valor de Tú"), "50000");
    expect(within(sheet).getByRole("button", { name: "Listo" })).toBeDisabled();
    // Closed with parts that do not add up yet, the expense cannot be saved.
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeDisabled();
    const again = await openWho();
    await userEvent.type(within(again).getByLabelText("Valor de Carlos (invitado)"), "70000");
    await userEvent.click(within(again).getByRole("button", { name: "Listo" }));
    await save();
    expect(await posted(requests)).toMatchObject({
      counterpart: { kind: "MEMBER", memberId: "m-carlos" },
      parts: { mine: cop(50_000), theirs: cop(70_000) },
    });
  });

  it("sends Porcentaje parts that add up to the amount exactly among Tú, Juan and Luis", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-ana-juan") });
    form(api);
    await dinner("100000");
    const sheet = await openWho();
    await userEvent.click(person(sheet, "Juan"));
    await userEvent.click(person(sheet, "Luis"));
    await userEvent.click(within(sheet).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(whoRow()).toHaveTextContent("para 3 personas");
    await save();
    const { parts } = (await posted(requests)) as {
      parts: {
        mine: { amount: string };
        theirs: { amount: string };
        others: { amount: { amount: string } }[];
      };
    };
    const minors = [parts.mine.amount, parts.theirs.amount, ...parts.others.map((o) => o.amount.amount)];
    expect(minors.reduce((sum, minor) => sum + BigInt(minor), 0n)).toBe(10_000_000n);
  });

  it("adds someone without Hearth by name, ticked, who is sent as a new guest", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/direct-splits": () => created("sp-new", true) });
    form(api);
    await dinner("50000");
    const sheet = await openWho();
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar a alguien" }));
    expect(within(sheet).getByRole("button", { name: "Agregar" })).toBeDisabled();
    await userEvent.type(within(sheet).getByLabelText("Nombre de quien no usa Hearth"), "Marta");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar" }));
    expect(person(sheet, "Marta")).toBeChecked();
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    await save();
    const body = await posted(requests);
    expect(body.counterpart).toEqual({ kind: "GUEST", displayName: "Marta" });
    expect(body).not.toHaveProperty("parts");
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-new/transactions", { scroll: false });
  });
});

describe("a personal expense for someone else needs a catalog category (P172)", () => {
  it("names the personal space by its own name, renamed or not (#170)", async () => {
    form(fakeApi({}).api, { space: spaceDto({ name: "Mis finanzas" }) });
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Mine" }));
    await tick("Luis");
    await save();
    expect(screen.getByRole("group", { name: "Categoría" })).toHaveAccessibleDescription(
      "Esta categoría es solo de tu espacio Mis finanzas. Elige una categoría predeterminada para dividir el gasto.",
    );
  });

  it("refuses a category of the person's own, and unticking the others records it as before", async () => {
    const { api, requests } = fakeApi({});
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Mine" }));
    await tick("Luis");
    await save();
    expect(screen.getByRole("group", { name: "Categoría" })).toHaveAccessibleDescription(
      "Esta categoría es solo de tu espacio Personal. Elige una categoría predeterminada para dividir el gasto.",
    );
    expect(requests).toHaveLength(0);
    await tick("Luis");
    expect(whoRow().textContent).toBe("Quién pagó y para quién Pagaste tú con Bancolombia");
  });

  it("asks for a category instead of blaming a missing one on the catalog", async () => {
    const { api, requests } = fakeApi({});
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await tick("Luis");
    await save();
    expect(screen.getByRole("group", { name: "Categoría" })).toHaveAccessibleDescription(
      "Elige una categoría.",
    );
    expect(requests).toHaveLength(0);
  });

  it("clears the category message as soon as a default category is chosen (S3)", async () => {
    form(fakeApi({}).api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await tick("Luis");
    await save();
    expect(screen.getByRole("group", { name: "Categoría" })).toHaveAccessibleDescription(
      "Elige una categoría.",
    );
    await chooseGroceries();
    expect(screen.queryByText("Elige una categoría.")).toBeNull();
  });

  it("does not blame a category of the person's own before the next save (S3)", async () => {
    form(fakeApi({}).api);
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await tick("Luis");
    await save();
    await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
    await userEvent.click(await screen.findByRole("radio", { name: "Mine" }));
    expect(screen.queryByText(/solo de tu espacio Personal/)).toBeNull();
    await save();
    expect(screen.getByText(/solo de tu espacio Personal/)).toBeInTheDocument();
  });
});

describe("saving a personal expense for someone else (P172)", () => {
  it("shows an API problem in the form and keeps the same key for a retry of the same draft", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/direct-splits": () =>
        calls++ === 0 ? problemResponse(422, "InvalidDirectCounterpart") : created("sp-ana-juan"),
    });
    form(api);
    await dinner("50000");
    await tick("Luis");
    await save();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await save();
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get("idempotency-key")).toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("takes a new key when someone else is ticked", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/direct-splits": () => problemResponse(500, "InternalError"),
    });
    form(api);
    await dinner("50000");
    await tick("Juan");
    await save();
    await screen.findByRole("alert");
    await tick("Juan", "Luis");
    await save();
    await screen.findByRole("alert");
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get("idempotency-key")).not.toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("offers the row only on an expense", async () => {
    form(fakeApi({}).api);
    expect(whoRow()).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Ingreso" }));
    expect(screen.queryByRole("button", { name: WHO_ROW })).not.toBeInTheDocument();
  });

  it("does not offer the personal row in a shared space even when it is given people", () => {
    form(fakeApi({}).api, { space: householdSpace() });
    expect(screen.queryByRole("button", { name: WHO_ROW })).not.toBeInTheDocument();
  });

  it("offers Tú and someone typed by name without the list of people", async () => {
    form(fakeApi({}).api, { people: undefined });
    const sheet = await openWho();
    expect(within(sheet).getAllByRole("checkbox")).toHaveLength(1);
    expect(within(sheet).getByRole("button", { name: "Agregar a alguien" })).toBeInTheDocument();
  });
});

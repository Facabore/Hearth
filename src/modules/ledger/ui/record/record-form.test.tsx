import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { RecordForm } from "./record-form";
import type { RecordKind } from "./record-request";

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
  subcategories: [
    categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }),
    categoryDto({ id: "c-meat", name: "Meat", parentCategoryId: "c-groceries" }),
  ],
});
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
  accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD", icon: "card" }),
];
const form = (api: Api, kind: RecordKind = "EXPENSE") =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind={kind}
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      api={api}
    />,
  );
const recorded = () => jsonResponse(transactionDto({ id: "t-new" }), 201);
const enterMarket = async () => {
  await userEvent.type(screen.getByLabelText("Monto"), "85000");
  await userEvent.type(screen.getByLabelText("Descripción"), "Market");
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
};

describe("the account picker can create an account and come back (N7)", () => {
  it("links to New account with a returnTo back to this form, with the type being recorded", async () => {
    const { api } = fakeApi({});
    form(api);
    await userEvent.click(screen.getByRole("button", { name: /Cuenta/ }));
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Fnew",
    );
  });

  it("keeps the type in the way back: a transfer returns to the transfer form", async () => {
    const { api } = fakeApi({});
    form(api, "TRANSFER");
    await userEvent.click(screen.getByRole("button", { name: /Desde/ }));
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/accounts/new?returnTo=%2Fspaces%2Fsp-personal%2Fnew%3Ftype%3Dtransfer",
    );
  });

  it("explains it when the person has no accounts yet", async () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={[]}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Cuenta/ }));
    expect(screen.getByText("No hay cuentas para elegir. Crea una nueva.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nueva cuenta" })).toBeInTheDocument();
  });
});

describe("the amount of a record groups its digits in the currency's own way (U3)", () => {
  it("groups the whole part and keeps the decimals the currency has", async () => {
    form(fakeApi({}).api);
    // Pasted whole, so it is grouped in one step: the currency's decimals decide whether the comma is a point.
    await userEvent.click(screen.getByLabelText("Monto"));
    await userEvent.paste("1234567,5");
    expect(screen.getByLabelText("Monto")).toHaveValue("1.234.567,5");
  });
});

describe("record form (HU-E9-03)", () => {
  it("records a personal expense now, in the browser's zone, with one idempotency key", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    const { container } = form(api);
    expect(screen.getByTestId("when-chip")).toHaveTextContent("Hoy · 23:30");
    await enterMarket();
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const [request] = requests;
    expect(request!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await request!.json()).toEqual({
      description: "Market",
      date: "2026-10-31",
      occurredAt: "2026-11-01T04:30:00.000Z",
      timeZone: "America/Bogota",
      categoryId: "c-groceries",
      amount: { amount: "8500000", currency: "COP" },
      accountId: "a-bank",
    });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/transactions");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("records the chosen subcategory and shows it as Groceries › Vegetables", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api);
    await enterMarket();
    await userEvent.click(screen.getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries › Vegetables" }));
    expect(screen.getByRole("button", { name: /Categoría/ })).toHaveTextContent("Groceries › Vegetables");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect((await requests[0]!.json()).categoryId).toBe("c-veg");
  });

  it("shows errors.InvalidAmount next to the amount and creates nothing", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidAmount"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Monto")).toHaveAccessibleDescription("El monto debe ser mayor que cero."),
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a double click once, and retries a failed request with the same key", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": async () => {
        calls += 1;
        // The failure takes a moment, as a real one does: the double click's second click lands while it is pending.
        if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 50));
        if (calls === 1) throw new TypeError("Failed to fetch");
        return recorded();
      },
    });
    form(api);
    await enterMarket();
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    const save = screen.getByRole("button", { name: "Guardar gasto" });
    await userEvent.dblClick(save);
    await screen.findByRole("alert");
    await userEvent.click(save);
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(requests).toHaveLength(2);
    expect(requests[1]!.headers.get("idempotency-key")).toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("sends nothing when the amount cannot be read, and says what to type", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "ochenta");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(screen.getByLabelText("Monto")).toHaveAccessibleDescription("Escribe un monto como 85.000.");
    expect(requests).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText("Monto"));
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(screen.queryByText(/Escribe un monto/)).toBeNull();
  });

  it("sends nothing without an account, and says so next to it", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    renderWithIntl(
      <RecordForm
        space={spaceDto()}
        accounts={[]}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        api={api}
      />,
    );
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(screen.getByRole("button", { name: /Cuenta/ })).toHaveAccessibleDescription("Elige una cuenta.");
    expect(requests).toHaveLength(0);
  });

  it("records an income into the receiving account on the incomes endpoint", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/incomes": recorded });
    form(api, "INCOME");
    await userEvent.type(screen.getByLabelText("Monto"), "1.200.000");
    expect(screen.getByRole("button", { name: /Cuenta que recibe/ })).toHaveTextContent("Bancolombia");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ingreso" }));
    expect(await requests[0]!.json()).toEqual({
      date: "2026-10-31",
      occurredAt: "2026-11-01T04:30:00.000Z",
      timeZone: "America/Bogota",
      amount: { amount: "120000000", currency: "COP" },
      accountId: "a-bank",
    });
  });

  it.each([
    ["CategoryArchived", /Categoría/, "Esta categoría está archivada. Elige otra o restáurala."],
    [
      "AccountArchived",
      /Cuenta/,
      "Esta cuenta está archivada. Restáurala para registrar movimientos en ella.",
    ],
  ])("shows %s next to its field and keeps the draft", async (code, field, message) => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, code) });
    form(api);
    await enterMarket();
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: field })).toHaveAccessibleDescription(message),
    );
    expect(screen.getByLabelText("Monto")).toHaveValue("85.000");
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeEnabled();
  });

  it("shows InvalidDescription under the description", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidDescription"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await userEvent.type(screen.getByLabelText("Descripción"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Descripción")).toHaveAccessibleDescription(
        "La descripción puede tener hasta 200 caracteres.",
      ),
    );
  });

  it("shows the date problem next to the date and time, and any other code above the button", async () => {
    let code = "DateTimeMismatch";
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, code) });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(screen.getByTestId("when-chip")).toHaveAccessibleDescription(
        "La fecha no coincide con la hora elegida. Revisa la fecha y la hora.",
      ),
    );
    code = "SomethingNewTheCatalogsLack";
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Algo salió mal. Intenta de nuevo.");
    expect(screen.getByRole("alert")).toHaveTextContent("Referencia: req-test");
    expect(screen.queryByText(/SomethingNew/)).toBeNull();
  });

  it("keeps the key of an unchanged draft after a 422 and gives an edited one a new key", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidAmount"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    await userEvent.type(screen.getByLabelText("Monto"), "5");
    await waitFor(() => expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeEnabled());
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(requests).toHaveLength(3));
    const keys = requests.map((r) => r.headers.get("idempotency-key"));
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("spends the draft's key on a save: a fresh one is drawn once the expense is recorded", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    const uuid = vi.spyOn(crypto, "randomUUID");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(uuid).toHaveBeenCalledTimes(1);
    uuid.mockRestore();
  });

  it("pays the credit card with a transfer between two accounts, without a category", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/transfers": recorded });
    form(api, "TRANSFER");
    expect(screen.queryByRole("button", { name: /Categoría/ })).toBeNull();
    await userEvent.type(screen.getByLabelText("Monto"), "200000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = screen.getByRole("dialog", { name: "Hacia" });
    expect(within(to).queryByRole("radio", { name: /Bancolombia/ })).toBeNull();
    await userEvent.click(within(to).getByRole("radio", { name: /Visa/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    expect(await requests[0]!.json()).toMatchObject({
      sourceAccountId: "a-bank",
      destinationAccountId: "a-visa",
      amount: { amount: "20000000" },
    });
  });

  it("clears the destination when the source becomes the same account, and sends nothing until it is chosen", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/transfers": recorded });
    form(api, "TRANSFER");
    await userEvent.type(screen.getByLabelText("Monto"), "200000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = screen.getByRole("dialog", { name: "Hacia" });
    await userEvent.click(within(to).getByRole("radio", { name: /Visa/ }));
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveTextContent("Visa");
    await userEvent.click(screen.getByRole("button", { name: /Desde/ }));
    const from = screen.getByRole("dialog", { name: "Desde" });
    await userEvent.click(within(from).getByRole("radio", { name: /Visa/ }));
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveTextContent("Elegir cuenta");
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveAccessibleDescription("Elige una cuenta.");
    expect(requests).toHaveLength(0);
  });
});

describe("record form: an error clears as soon as its field changes (390 px review, S3)", () => {
  const failing = (code: string) =>
    fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, code) });
  const save = () => userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));

  it("clears the category error when a category is chosen, and keeps the other errors", async () => {
    const { api } = failing("CategoryRequired");
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await save();
    const category = await screen.findByRole("button", { name: /Categoría/ });
    await waitFor(() => expect(category).toHaveAccessibleDescription("Elige una categoría."));
    await userEvent.click(category);
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    expect(screen.queryByText("Elige una categoría.")).toBeNull();
    expect(screen.getByRole("button", { name: /Categoría/ })).not.toHaveAccessibleDescription();
  });

  it("clears the amount error while typing, and leaves another field's error alone", async () => {
    const { api } = failing("InvalidAmount");
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await save();
    await waitFor(() =>
      expect(screen.getByLabelText("Monto")).toHaveAccessibleDescription("El monto debe ser mayor que cero."),
    );
    await userEvent.type(screen.getByLabelText("Descripción"), "Market");
    expect(screen.getByLabelText("Monto")).toHaveAccessibleDescription("El monto debe ser mayor que cero.");
    await userEvent.type(screen.getByLabelText("Monto"), "5");
    expect(screen.queryByText("El monto debe ser mayor que cero.")).toBeNull();
  });

  it("clears the unreadable-amount message when the amount is edited", async () => {
    const { api } = failing("InvalidAmount");
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "ochenta");
    await save();
    expect(screen.getByLabelText("Monto")).toHaveAccessibleDescription("Escribe un monto como 85.000.");
    await userEvent.type(screen.getByLabelText("Monto"), "1");
    expect(screen.queryByText(/Escribe un monto/)).toBeNull();
  });

  it("clears the description error when the description changes", async () => {
    const { api } = failing("InvalidDescription");
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await userEvent.type(screen.getByLabelText("Descripción"), "x");
    await save();
    await waitFor(() =>
      expect(screen.getByLabelText("Descripción")).toHaveAccessibleDescription(
        "La descripción puede tener hasta 200 caracteres.",
      ),
    );
    await userEvent.type(screen.getByLabelText("Descripción"), "y");
    expect(screen.queryByText("La descripción puede tener hasta 200 caracteres.")).toBeNull();
  });

  it("clears the account error when another account is chosen", async () => {
    const { api } = failing("AccountArchived");
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await save();
    const message = "Esta cuenta está archivada. Restáurala para registrar movimientos en ella.";
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cuenta/ })).toHaveAccessibleDescription(message),
    );
    await userEvent.click(screen.getByRole("button", { name: /Cuenta/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Cuenta" })).getByRole("radio", { name: /Visa/ }),
    );
    expect(screen.queryByText(message)).toBeNull();
  });

  it("clears the date error when the date and time are applied", async () => {
    const { api } = failing("DateTimeMismatch");
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await save();
    const message = "La fecha no coincide con la hora elegida. Revisa la fecha y la hora.";
    await waitFor(() => expect(screen.getByTestId("when-chip")).toHaveAccessibleDescription(message));
    await userEvent.click(screen.getByTestId("when-chip"));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Usar/ }));
    expect(screen.queryByText(message)).toBeNull();
  });

  it("clears the destination error when another destination is chosen", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/transfers": () => problemResponse(422, "SameAccountTransfer"),
    });
    form(api, "TRANSFER");
    await userEvent.type(screen.getByLabelText("Monto"), "200000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Hacia" })).getByRole("radio", { name: /Visa/ }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Hacia/ })).toHaveAccessibleDescription(/\S/),
    );
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Hacia" })).getByRole("radio", { name: /Bancolombia|Visa/ }),
    );
    expect(screen.getByRole("button", { name: /Hacia/ })).not.toHaveAccessibleDescription();
  });
});

describe("record form: the way back (S1)", () => {
  it("has a Volver link to the space home, next to the title", () => {
    form(fakeApi({}).api);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal");
    expect(screen.getByRole("heading", { level: 1, name: "Registrar movimiento" })).toBeInTheDocument();
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  cop,
  groupDto,
  guestDto,
  householdSpace,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto, TransactionDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import type { SharedExpenseContext } from "../split/shared-context";
import { EditTransactionForm } from "./edit-transaction-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const PATCH = "PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}";
const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
});
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia" }),
  accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD", icon: "card" }),
];
const tx = transactionDto({
  id: "t-1",
  type: "EXPENSE",
  description: "Market",
  amount: cop(85_000),
  date: "2026-10-31",
  occurredAt: "2026-10-31T17:30:00.000Z",
  timeZone: "America/Bogota",
  categoryId: "c-groceries",
  payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(85_000) }],
  shares: [{ memberId: "m-ana", amount: cop(85_000), splitMethod: "EQUAL" }],
  version: 2,
});
const LIST = "/spaces/s-1/transactions?period=2026-10";
const SHEET = `${LIST}&tx=t-1`;

const renderForm = (
  api: Api,
  origin = LIST,
  extra: {
    tx?: TransactionDto;
    profileZone?: string;
    shared?: SharedExpenseContext;
    space?: SpaceDto;
  } = {},
) =>
  renderWithIntl(
    <ToastProvider>
      <EditTransactionForm
        space={extra.space ?? spaceDto({ id: "s-1" })}
        tx={extra.tx ?? tx}
        accounts={accounts}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        profileZone={extra.profileZone ?? "America/Bogota"}
        origin={origin}
        api={api}
        {...(extra.shared ? { shared: extra.shared } : {})}
      />
    </ToastProvider>,
  );
const retype = async (value: string) => {
  await userEvent.clear(screen.getByLabelText("Monto"));
  await userEvent.type(screen.getByLabelText("Monto"), value);
};
const save = () => userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
const goToYesterday = async () => {
  await userEvent.click(screen.getByTestId("when-chip"));
  const sheet = screen.getByRole("dialog", { name: "Fecha y hora" });
  await userEvent.click(within(sheet).getByRole("radio", { name: /Ayer/ }));
  await userEvent.click(within(sheet).getByRole("button", { name: /^Usar/ }));
};

describe("edit a transaction (rulings P191, P193)", () => {
  it("sends only the new amount with If-Match, returns to its sheet and says Cambios guardados", async () => {
    const { api, requests } = fakeApi({
      [PATCH]: () => jsonResponse({ ...tx, amount: cop(95_000), version: 3 }),
    });
    renderForm(api);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await retype("95000");
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(SHEET));
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request!.method).toBe("PATCH");
    expect(new URL(request!.url).pathname).toBe("/api/v1/spaces/s-1/transactions/t-1");
    expect(request!.headers.get("if-match")).toBe('"2"');
    expect(await request!.json()).toEqual({ amount: { amount: "9500000", currency: "COP" } });
    expect(router.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cambios guardados"));
  });

  it("goes back to the sheet without a request or a toast when nothing changed", async () => {
    const { api, requests } = fakeApi({});
    renderForm(api);
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(SHEET));
    expect(requests).toEqual([]);
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("sends a cleared description as an empty one", async () => {
    const { api, requests } = fakeApi({
      [PATCH]: () => jsonResponse({ ...tx, description: "", version: 3 }),
    });
    renderForm(api);
    await userEvent.clear(screen.getByLabelText("Descripción"));
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({ description: "" });
  });

  it("moves the date with its time in the record's own zone, not the editor's", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...tx, version: 3 }) });
    // 17:30Z is 11:30 in Mexico City, and the editor's clock (Bogotá) says it is already Oct 31 at night.
    renderForm(api, LIST, {
      tx: { ...tx, timeZone: "America/Mexico_City" },
      profileZone: "America/Bogota",
    });
    expect(screen.getByTestId("when-chip")).toHaveTextContent("Hoy · 11:30");
    await goToYesterday();
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({
      date: "2026-10-30",
      occurredAt: "2026-10-30T17:30:00.000Z",
      timeZone: "America/Mexico_City",
    });
  });

  it("sends the time of an untimed row only when its date or time is changed", async () => {
    const untimed = { ...tx, occurredAt: null, timeZone: null };
    const first = fakeApi({ [PATCH]: () => jsonResponse({ ...untimed, version: 3 }) });
    const { unmount } = renderForm(first.api, LIST, { tx: untimed });
    await retype("95000");
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await first.requests[0]!.json()).toEqual({ amount: { amount: "9500000", currency: "COP" } });
    unmount();

    const second = fakeApi({ [PATCH]: () => jsonResponse({ ...untimed, version: 3 }) });
    renderForm(second.api, LIST, { tx: untimed });
    await goToYesterday();
    await save();
    await waitFor(() => expect(second.requests).toHaveLength(1));
    // The editor's clock (23:30 in Bogotá) becomes the row's first time.
    expect(await second.requests[0]!.json()).toEqual({
      date: "2026-10-30",
      occurredAt: "2026-10-31T04:30:00.000Z",
      timeZone: "America/Bogota",
    });
  });

  it("sends a shared expense's new amount with its split, and the payer only when it changed", async () => {
    const shared: SharedExpenseContext = {
      members: [memberDto({ id: "m-ana", userId: "u-ana" }), memberDto({ id: "m-juan", userId: "u-juan" })],
      meMemberId: "m-ana",
      myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
      funds: [],
    };
    const two = transactionDto({
      ...tx,
      amount: cop(300_000),
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(300_000) }],
      shares: [
        { memberId: "m-ana", amount: cop(150_000), splitMethod: "EQUAL" },
        { memberId: "m-juan", amount: cop(150_000), splitMethod: "EQUAL" },
      ],
    });
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...two, version: 3 }) });
    renderForm(api, LIST, { tx: two, shared, space: householdSpace({ id: "s-1" }) });
    await retype("400000");
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({
      amount: { amount: "40000000", currency: "COP" },
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
  });

  it("shows a version conflict with a way to load the latest version, and saves nothing", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => problemResponse(412, "PreconditionFailed") });
    const { container } = renderForm(api);
    await retype("95000");
    await save();
    expect(
      await screen.findByText(
        "Alguien cambió esto mientras lo editabas. Recarga para ver la última versión.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Se descartarán los cambios que escribiste.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(await axeViolations(container)).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Cargar la última versión" }));
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it("offers the reload only for a version conflict", async () => {
    const { api } = fakeApi({ [PATCH]: () => problemResponse(403, "InsufficientRole") });
    renderForm(api);
    await retype("95000");
    await save();
    expect(await screen.findByText("No tienes permiso para hacer esto en este espacio.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar la última versión" })).not.toBeInTheDocument();
    expect(screen.queryByText("Se descartarán los cambios que escribiste.")).not.toBeInTheDocument();
  });

  it("shows a field's problem next to it (P118) and lets the person save again", async () => {
    let answer = () => problemResponse(422, "AccountNotOwned");
    const { api } = fakeApi({ [PATCH]: () => answer() });
    renderForm(api);
    await userEvent.click(screen.getByRole("button", { name: /Cuenta/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Cuenta" })).getByRole("radio", { name: /Visa/ }),
    );
    await save();
    const message = "Solo el dueño de esa cuenta puede registrar movimientos con ella.";
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Cuenta/ })).toHaveAccessibleDescription(message),
    );
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(screen.queryByRole("button", { name: "Cargar la última versión" })).not.toBeInTheDocument();

    answer = () => problemResponse(412, "PreconditionFailed");
    await save();
    expect(await screen.findByRole("button", { name: "Cargar la última versión" })).toBeInTheDocument();
  });

  it("says so when the request cannot be made, and saves nothing", async () => {
    const { api } = fakeApi({});
    renderForm(api);
    await retype("95000");
    await save();
    expect(await screen.findByText("Algo salió mal. Intenta de nuevo.")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("has a way back to the sheet it came from", () => {
    const { api } = fakeApi({});
    renderForm(api);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", SHEET);
  });

  it("sends nothing for a guest-paid shared expense nobody changed", async () => {
    const { api, requests } = fakeApi({});
    const shared: SharedExpenseContext = {
      members: [memberDto({ id: "m-ana", userId: "u-ana" }), guestDto({ id: "m-pedro" })],
      meMemberId: "m-ana",
      myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
      funds: [],
    };
    const guestPaid = transactionDto({
      ...tx,
      payments: [{ memberId: "m-pedro", accountId: null, amount: cop(85_000) }],
      shares: [
        { memberId: "m-ana", amount: cop(42_500), splitMethod: "EQUAL" },
        { memberId: "m-pedro", amount: cop(42_500), splitMethod: "EQUAL" },
      ],
    });
    renderForm(api, LIST, { tx: guestPaid, shared, space: householdSpace({ id: "s-1" }) });
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(SHEET));
    expect(requests).toEqual([]);
  });
});

// Issue #171 on the edit route: the form a transaction opens in is the compact record form, so it fits above the
// bottom bar in every context (an expense, an income, a shared expense with its split).
describe("the edit form is the compact record form (#171)", () => {
  const sharedTwo: SharedExpenseContext = {
    members: [memberDto({ id: "m-ana", userId: "u-ana" }), memberDto({ id: "m-juan", userId: "u-juan" })],
    meMemberId: "m-ana",
    myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
    funds: [],
  };
  const splitTx = transactionDto({
    ...tx,
    shares: [
      { memberId: "m-ana", amount: cop(42_500), splitMethod: "EQUAL" },
      { memberId: "m-juan", amount: cop(42_500), splitMethod: "EQUAL" },
    ],
  });
  const income = transactionDto({
    ...tx,
    type: "INCOME",
    description: "Salary",
    destinationAccountId: "a-bank",
    payments: [],
    shares: [],
  });
  const rowNames = () =>
    within(screen.getByRole("list", { name: "Detalles del movimiento" }))
      .getAllByRole("button")
      .map((row) => {
        expect(row).toHaveClass("min-h-12");
        return row.firstElementChild?.nextElementSibling?.textContent;
      });
  const expectPhoneKeyboard = () => {
    const amount = screen.getByLabelText("Monto");
    expect(amount).toHaveAttribute("inputmode", "decimal");
    // The edit leaves the focus alone, so the keyboard comes up only when the person taps the amount.
    expect(amount).not.toHaveFocus();
    for (const key of ["0", "1", "9", "000", "Borrar"])
      expect(screen.queryByRole("button", { name: key })).not.toBeInTheDocument();
  };

  it("takes an expense's amount on the phone's keyboard, with no keypad, and its details as 48 px rows", async () => {
    const { container } = renderForm(fakeApi({}).api);
    expectPhoneKeyboard();
    expect(rowNames()).toEqual(["Categoría", "Cuenta", "Fecha"]);
    expect(screen.getAllByRole("button").at(-1)).toHaveAccessibleName("Guardar cambios");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("does the same for an income, whose account row names where it was received", () => {
    renderForm(fakeApi({}).api, LIST, { tx: income });
    expectPhoneKeyboard();
    expect(rowNames()).toEqual(["Categoría", "Cuenta que recibe", "Fecha"]);
    expect(screen.getAllByRole("button").at(-1)).toHaveAccessibleName("Guardar cambios");
  });

  it("does the same for a shared expense with its split, and keeps Guardar cambios last", () => {
    renderForm(fakeApi({}).api, LIST, {
      tx: splitTx,
      shared: sharedTwo,
      space: householdSpace({ id: "s-1" }),
    });
    expectPhoneKeyboard();
    // Who paid replaces the account row (P168); the division sits under Más opciones (#171).
    expect(rowNames()).toEqual(["Categoría", "Fecha"]);
    expect(screen.getByRole("button", { name: /Pagas tú/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /División/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button").at(-1)).toHaveAccessibleName("Guardar cambios");
  });
});

describe("change a movement's type while editing it (issue #195)", () => {
  const CONVERT = "POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/convert";
  const UNDO = "POST /api/v1/spaces/{spaceId}/transactions/{transactionId}/convert/undo";
  const transfer = transactionDto({ ...tx, id: "t-new", type: "TRANSFER", version: 1 });

  it("switches an expense to a transfer with its amount, description, time and account, and asks for the second account", async () => {
    const { api, requests } = fakeApi({ [CONVERT]: () => jsonResponse(transfer, 201) });
    renderForm(api);
    expect(screen.getByRole("tab", { name: "Gasto" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(screen.getByRole("tab", { name: "Transferencia" }));
    expect(screen.getByText(/este movimiento cambia a Transferencia/)).toBeInTheDocument();
    expect(screen.getByLabelText("Monto")).toHaveValue("85.000");
    expect(screen.getByLabelText("Descripción")).toHaveValue("Market");
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Bancolombia");
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveTextContent("Elegir cuenta");
    await save();
    expect(requests).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Hacia" })).getByRole("radio", { name: /Visa/ }),
    );
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`${LIST}&tx=t-new`));
    const [request] = requests;
    expect(new URL(request!.url).pathname).toBe("/api/v1/spaces/s-1/transactions/t-1/convert");
    expect(request!.headers.get("if-match")).toBe('"2"');
    expect(await request!.json()).toEqual({
      type: "TRANSFER",
      description: "Market",
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:30:00.000Z",
      timeZone: "America/Bogota",
      amount: { amount: "8500000", currency: "COP" },
      sourceAccountId: "a-bank",
      destinationAccountId: "a-visa",
    });
    expect(router.refresh).toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ahora es una transferencia"));
  });

  it("undoes the conversion from the toast and shows the original's sheet again", async () => {
    const { api, requests } = fakeApi({
      [CONVERT]: () => jsonResponse(transfer, 201),
      [UNDO]: () => jsonResponse({ ...tx, version: 4 }),
    });
    renderForm(api);
    await userEvent.click(screen.getByRole("tab", { name: "Transferencia" }));
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Hacia" })).getByRole("radio", { name: /Visa/ }),
    );
    await save();
    await userEvent.click(await screen.findByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(router.replace).toHaveBeenLastCalledWith(SHEET));
    expect(new URL(requests[1]!.url).pathname).toBe("/api/v1/spaces/s-1/transactions/t-1/convert/undo");
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Gasto restaurado"));
  });

  it("shows a refused conversion in the form and stays on it", async () => {
    const { api } = fakeApi({ [CONVERT]: () => problemResponse(409, "AccountArchived") });
    renderForm(api);
    await userEvent.click(screen.getByRole("tab", { name: "Transferencia" }));
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Hacia" })).getByRole("radio", { name: /Visa/ }),
    );
    await save();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("switching back to the movement's own kind edits it as before, with a PATCH", async () => {
    const { api, requests } = fakeApi({
      [PATCH]: () => jsonResponse({ ...tx, amount: cop(95_000), version: 3 }),
    });
    renderForm(api);
    await userEvent.click(screen.getByRole("tab", { name: "Ingreso" }));
    await userEvent.click(screen.getByRole("tab", { name: "Gasto" }));
    expect(screen.queryByText(/este movimiento cambia a/)).not.toBeInTheDocument();
    await retype("95000");
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(SHEET));
    expect(requests.map((r) => r.method)).toEqual(["PATCH"]);
  });

  it("keeps the type fixed in a shared space", () => {
    renderForm(fakeApi({}).api, LIST, { space: householdSpace() });
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Tipo: Gasto")).toBeInTheDocument();
  });
});

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { AccountUsageDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { SharedExpenseContext } from "../split/shared-context";
import { RecordForm, type RecordFormProps } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T15:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const gas = categoryDto({ id: "c-gas", name: "Gas", parentCategoryId: "c-bills" });
const bills = categoryDto({ id: "c-bills", name: "Bills Home", subcategories: [gas] });
const market = categoryDto({ id: "c-market", name: "Mercado" });
const groups = [groupDto({ id: "g-home", name: "Hogar", categories: [bills, market] })];

// By name, as the API lists them; the person's balance is in Efectivo.
const AMEX = accountDto({ id: "a-amex", name: "AMEX Bancolombia", type: "CREDIT_CARD" });
const BANCOLOMBIA = accountDto({ id: "a-bancolombia", name: "Bancolombia" });
const CASH = accountDto({
  id: "a-cash",
  name: "Efectivo",
  type: "CASH",
  balance: { amount: "50000000", currency: "COP" },
});
const NEQUI = accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET" });
const OLD = accountDto({ id: "a-old", name: "Cuenta vieja", archivedAt: "2026-10-01T00:00:00.000Z" });
const ACCOUNTS = [AMEX, BANCOLOMBIA, CASH, OLD, NEQUI];

/** Ruling P337: Bancolombia is the most used, then Nequi; Gas was last paid from Bancolombia, Mercado from Nequi. */
const USAGE: AccountUsageDto = {
  since: "2026-08-19",
  accounts: [
    { accountId: "a-bancolombia", uses: 40, lastUsedOn: "2026-11-15" },
    { accountId: "a-nequi", uses: 12, lastUsedOn: "2026-11-14" },
  ],
  categories: [
    { categoryId: "c-gas", accountId: "a-bancolombia" },
    { categoryId: "c-market", accountId: "a-nequi" },
  ],
};

const form = (extra: Partial<RecordFormProps> = {}) => {
  const { api, requests } = fakeApi({
    "POST /api/v1/spaces/{spaceId}/expenses": () =>
      jsonResponse(
        { spaceId: "sp-personal", created: false, expense: { ...transactionDto(), warnings: [] } },
        201,
      ),
    "GET /api/v1/spaces/{spaceId}/default-split": () => jsonResponse({}, 404),
  });
  const view = renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={ACCOUNTS}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-16T15:00:00.000Z"
      timeZone="America/Bogota"
      api={api}
      accountUsage={USAGE}
      {...extra}
    />,
  );
  return { ...view, requests };
};

const WHO_ROW = /Quién pagó y para quién/;
const whoRow = () => screen.getByRole("button", { name: WHO_ROW });
const openWho = async () => {
  await userEvent.click(whoRow());
  return screen.findByRole("dialog", { name: "¿Quién pagó y para quién?" });
};
const desde = (sheet: HTMLElement) => within(sheet).getByRole("radiogroup", { name: "Desde" });
const chipsOf = (group: HTMLElement) =>
  within(group)
    .getAllByRole("radio")
    .map((radio) => radio.textContent);
const choose = async (category: string, sub?: string) => {
  await userEvent.click(await screen.findByRole("button", { name: "Elegir categoría" }));
  await userEvent.click(await screen.findByRole("radio", { name: category }));
  if (sub) await userEvent.click(screen.getByRole("radio", { name: sub }));
};

describe("Desde lists only the person's money accounts, the most used first (ruling P337)", () => {
  it("puts the most used first, the rest by name, and never an archived account", async () => {
    form();
    const sheet = await openWho();

    expect(chipsOf(desde(sheet))).toEqual(["Bancolombia", "Nequi", "AMEX Bancolombia", "Efectivo"]);
  });

  it("lists them by name when the usage cannot be read", async () => {
    form({ accountUsage: null });
    const sheet = await openWho();

    expect(chipsOf(desde(sheet))).toEqual(["AMEX Bancolombia", "Bancolombia", "Efectivo", "Nequi"]);
  });

  it("orders the account picker the same way, for an income's account", async () => {
    form({ initialKind: "INCOME" });
    await userEvent.click(screen.getByRole("button", { name: /Cuenta que recibe/ }));
    const picker = await screen.findByRole("dialog", { name: "Cuenta que recibe" });

    expect(
      within(picker)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Bancolombia", "Nequi", "AMEX Bancolombia", "Efectivo"]);
  });
});

describe("a new expense or income waits for the person to choose its account (P348)", () => {
  const save = () => screen.getByRole("button", { name: "Guardar gasto" });
  const whoSheet = () => screen.findByRole("dialog", { name: "¿Quién pagó y para quién?" });

  it("starts an expense on no account, whatever was paid last or where the money is", () => {
    localStorage.setItem("hearth.lastAccount", "a-amex");
    form();

    expect(whoRow()).toHaveTextContent("Pagaste tú");
    expect(whoRow()).not.toHaveTextContent("Pagaste tú con");
  });

  it("opens ¿Quién pagó y para quién? once the category is chosen, with no account ticked", async () => {
    const { requests } = form();
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await choose("Bills Home", "Gas");

    const sheet = await whoSheet();
    expect(within(desde(sheet)).queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    await userEvent.click(within(desde(sheet)).getByRole("radio", { name: "Bancolombia" }));
    // Ruling P337's hint still says why, once the person picks the account they usually pay the category from.
    expect(within(sheet).getByText("Bancolombia: con la que sueles pagar Gas.")).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    await userEvent.click(save());

    expect(await requests[0]!.json()).toMatchObject({ categoryId: "c-gas", accountId: "a-bancolombia" });
  });

  it("asks for the account when the expense is saved without one", async () => {
    const { requests } = form();
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await choose("Mercado");
    await whoSheet();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(save());

    expect(await screen.findByText("Elige una cuenta.")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("opens nothing for a later category once the account is chosen, and keeps it", async () => {
    form();
    await userEvent.type(screen.getByLabelText("Monto"), "50000");
    await choose("Mercado");
    const sheet = await whoSheet();
    await userEvent.click(within(desde(sheet)).getByRole("radio", { name: "Nequi" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    await choose("Bills Home", "Gas");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(whoRow()).toHaveTextContent("Pagaste tú con Nequi");
  });

  it("starts on the account whose screen the form was opened from, and opens nothing after the category", async () => {
    form({ returnTo: "/spaces/sp-personal/accounts/a-nequi" });
    expect(whoRow()).toHaveTextContent("Pagaste tú con Nequi");

    await choose("Bills Home", "Gas");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(whoRow()).toHaveTextContent("Pagaste tú con Nequi");
  });

  it("ignores an account screen of another space or of an account Desde does not offer", () => {
    form({ returnTo: "/spaces/sp-other/accounts/a-nequi" });
    expect(whoRow()).not.toHaveTextContent("Pagaste tú con");
  });

  it("leaves a transfer's starting account behind when the kind turns into an expense", async () => {
    form({ initialKind: "TRANSFER" });
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Efectivo");

    await userEvent.click(screen.getByRole("tab", { name: "Gasto" }));
    expect(whoRow()).not.toHaveTextContent("Pagaste tú con");
    await userEvent.click(screen.getByRole("tab", { name: "Transferencia" }));

    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Efectivo");
  });

  it("starts an income on no account and opens Cuenta que recibe once the category is chosen", async () => {
    const income = groupDto({
      id: "g-income",
      key: "income",
      name: "Ingresos",
      categories: [categoryDto({ id: "c-salary", groupId: "g-income", name: "Salario" })],
    });
    form({ initialKind: "INCOME", groups: [...groups, income] });
    expect(screen.getByRole("button", { name: /Cuenta que recibe/ })).toHaveTextContent("Elegir cuenta");

    await choose("Salario");
    const picker = await screen.findByRole("dialog", { name: "Cuenta que recibe" });
    expect(within(picker).queryByRole("radio", { checked: true })).not.toBeInTheDocument();
    await userEvent.click(within(picker).getByRole("radio", { name: "Nequi" }));

    expect(screen.getByRole("button", { name: /Cuenta que recibe/ })).toHaveTextContent("Nequi");
  });
});

describe("in a shared space, the account the recorder pays from (ruling P337)", () => {
  const shared: SharedExpenseContext = {
    members: [
      memberDto(),
      memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
    ],
    meMemberId: "m-ana",
    myAccounts: [AMEX, BANCOLOMBIA, CASH, NEQUI],
    funds: [],
  };

  it("lists the most used first and preselects the one the category was last paid from", async () => {
    form({ space: householdSpace(), accounts: [], shared });
    await choose("Mercado");

    expect(screen.getByRole("button", { name: WHO_ROW })).toHaveTextContent("Pagaste tú con Nequi");
    const sheet = await openWho();
    expect(chipsOf(desde(sheet))).toEqual(["Bancolombia", "Nequi", "AMEX Bancolombia", "Efectivo"]);
    expect(within(sheet).getByText("Nequi: con la que sueles pagar Mercado.")).toBeInTheDocument();
  });
});

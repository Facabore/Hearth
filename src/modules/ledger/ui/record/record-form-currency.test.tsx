import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDto,
  groupDto,
  householdSpace,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { RecordForm } from "./record-form";
import type { RecordKind } from "./record-request";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

// A personal space in COP (board 4): Bancolombia in pesos, and Chase in dollars.
const BANK = accountDto({ id: "a-bank", name: "Bancolombia", balance: { amount: "0", currency: "COP" } });
const CHASE = accountDto({ id: "a-chase", name: "Chase", balance: { amount: "0", currency: "USD" } });
const form = (api: Api, kind: RecordKind = "EXPENSE", accounts: AccountDto[] = [BANK, CHASE]) =>
  renderWithIntl(
    <RecordForm
      space={spaceDto()}
      accounts={accounts}
      groups={[groupDto()]}
      formats={BUILT_IN_FORMATS}
      initialKind={kind}
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      api={api}
      favoriteCurrencies={["USD", "EUR"]}
    />,
  );
const posted = async (requests: Request[]) =>
  (await requests
    .find((r) => r.method === "POST")!
    .clone()
    .json()) as Record<string, unknown>;
const rateReads = (requests: Request[]) =>
  requests.filter((r) => r.method === "GET" && new URL(r.url).pathname === "/api/v1/exchange-rates");
// 2026-11-01T04:30Z is 23:30 of 31 Oct in Bogotá: the form's date, which the rate is asked for.
// The server converts the asked `amount` (Money.convert); the fake answers from `converted`, by amount in USD cents.
const rate =
  (value = "4100", converted: Readonly<Record<string, string>> = { "5000": "20500000" }): FakeHandler =>
  (request) => {
    const query = new URL(request.url).searchParams;
    const amount = query.get("amount");
    const figure = amount === null ? undefined : converted[amount];
    return query.get("base") === "USD" && query.get("quote") === "COP" && query.get("on") === "2026-10-31"
      ? jsonResponse({
          rate: value,
          on: "2026-10-30",
          ...(figure === undefined ? {} : { converted: { amount: figure, currency: "COP" } }),
        })
      : problemResponse(404, "ExchangeRateNotFound");
  };
const amountsAsked = (requests: Request[]) =>
  rateReads(requests)
    .map((r) => new URL(r.url).searchParams.get("amount"))
    .filter((amount) => amount !== null);
const currencyChip = () => screen.getByRole("button", { name: /^Moneda: / });
const chooseCurrency = async (name: RegExp) => {
  await userEvent.click(currencyChip());
  const sheet = await screen.findByRole("dialog", { name: /Moneda del/ });
  await userEvent.click(within(sheet).getByRole("button", { name }));
};
const save = (kind = "gasto") => userEvent.click(screen.getByRole("button", { name: `Guardar ${kind}` }));

describe("the movement's currency (P342, board 7)", () => {
  it("starts in the space's currency, even from an account in another (owner: la del espacio por defecto)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": () => jsonResponse({ rate: "0.00025", on: "2026-10-31" }),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-1" }), 201),
    });
    form(api, "EXPENSE", [CHASE]);
    expect(currencyChip()).toHaveAccessibleName(/\(COP\)/);
    await userEvent.type(screen.getByLabelText("Monto"), "200000");
    await save();
    expect((await posted(requests)).amount).toEqual({ amount: "20000000", currency: "COP" });
  });

  it("lists the space's currency first, then the favorites, and a chosen one writes every figure", async () => {
    const { api } = fakeApi({ "GET /api/v1/exchange-rates": rate() });
    form(api);
    await userEvent.click(currencyChip());
    const sheet = await screen.findByRole("dialog", { name: "Moneda del gasto" });
    const headings = within(sheet)
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent);
    expect(headings).toEqual(["De este espacio", "Favoritas", "Todas"]);
    const space = within(sheet).getByRole("region", { name: "De este espacio" });
    expect(within(space).getByRole("button")).toHaveTextContent("COP · por defecto en Personal");
    await userEvent.click(within(sheet).getByRole("button", { name: /^Dólar estadounidense/ }));
    expect(currencyChip()).toHaveAccessibleName(/\(USD\)/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    expect(screen.getByLabelText("Monto").parentElement).toHaveTextContent("USD");
  });
});

describe("paying from an account in another currency (P342, board 4)", () => {
  it("suggests what the account paid at the day's rate and sends it as accountAmount", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": rate(),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-usd" }), 201),
    });
    form(api);
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP pagó" });
    await waitFor(() => expect(within(card).getByText("205.000 COP")).toBeInTheDocument());
    expect(card).toHaveTextContent("Sugerido con 4.100 COP por dólar estadounidense (30 oct).");
    await save();
    expect(await posted(requests)).toMatchObject({
      amount: { amount: "5000", currency: "USD" },
      accountId: "a-bank",
      accountAmount: { amount: "20500000", currency: "COP" },
    });
    expect("convertedAmount" in (await posted(requests))).toBe(false);
    expect(rateReads(requests).length).toBeGreaterThan(0);
  });

  it("shows and sends the server's converted figure, asked once for the settled amount, never rounding itself", async () => {
    // 4.100 × 50 would be 205.000; the server's figure differs on purpose, so only it can be what the card shows.
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": rate("4100", { "5000": "20499999" }),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-usd" }), 201),
    });
    form(api);
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP pagó" });
    await waitFor(() => expect(within(card).getByText("204.999,99 COP")).toBeInTheDocument());
    expect(card).toHaveTextContent("Sugerido con 4.100 COP por dólar estadounidense (30 oct).");
    expect(amountsAsked(requests)).toEqual(["5000"]);
    await save();
    expect((await posted(requests)).accountAmount).toEqual({ amount: "20499999", currency: "COP" });
  });

  it("shows no figure and sends no leg while the server has not converted the amount", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": rate("4100", {}),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-usd" }), 201),
    });
    form(api);
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP pagó" });
    await waitFor(() => expect(amountsAsked(requests)).toEqual(["5000"]));
    expect(card).toHaveTextContent("Sugerido con 4.100 COP por dólar estadounidense (30 oct).");
    expect(within(card).queryByText(/COP$/)).toBeNull();
    await save();
    expect("accountAmount" in (await posted(requests))).toBe(false);
  });

  it("sends the value the person typed instead of the suggestion", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": rate(),
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-usd" }), 201),
    });
    form(api);
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP pagó" });
    await userEvent.click(within(card).getByRole("button", { name: "¿Cobró otro valor? Escríbelo" }));
    await userEvent.type(within(card).getByLabelText("¿Cuánto pagó tu Bancolombia?"), "210000");
    await waitFor(() => expect(within(card).getByText("210.000 COP")).toBeInTheDocument());
    await save();
    expect((await posted(requests)).accountAmount).toEqual({ amount: "21000000", currency: "COP" });
  });

  it("asks to type the value when no rate covers the day, and shows the API's refusal there", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": () => problemResponse(404, "ExchangeRateNotFound"),
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "ExchangeRateRequired"),
    });
    form(api);
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP pagó" });
    const field = await within(card).findByLabelText("¿Cuánto pagó tu Bancolombia?");
    expect(card).toHaveTextContent("No hay tasa para ese día");
    await save();
    expect("accountAmount" in (await posted(requests))).toBe(false);
    await waitFor(() => expect(field).toBeInvalid());
    expect(field).toHaveAccessibleDescription(/.+/);
  });

  it("mirrors an income: what the account received", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": rate(),
      "POST /api/v1/spaces/{spaceId}/incomes": () =>
        jsonResponse(transactionDto({ id: "t-in", type: "INCOME" }), 201),
    });
    form(api, "INCOME");
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP recibió" });
    await waitFor(() => expect(within(card).getByText("205.000 COP")).toBeInTheDocument());
    await save("ingreso");
    expect(await posted(requests)).toMatchObject({
      amount: { amount: "5000", currency: "USD" },
      accountId: "a-bank",
      accountAmount: { amount: "20500000", currency: "COP" },
    });
  });

  it("posts a COP expense from a COP account exactly as before: no card, no rate, no leg", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => jsonResponse(transactionDto({ id: "t-cop" }), 201),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    expect(screen.queryByRole("group", { name: /^Tu Bancolombia/ })).toBeNull();
    await save();
    expect(Object.keys(await posted(requests)).sort()).toEqual(
      ["accountId", "amount", "date", "occurredAt", "timeZone"].sort(),
    );
    expect((await posted(requests)).amount).toEqual({ amount: "8500000", currency: "COP" });
    expect(rateReads(requests)).toHaveLength(0);
  });
});

describe("a shared expense in another currency (P342)", () => {
  it("splits in the chosen currency and sends what the recorder's account paid", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/exchange-rates": rate(),
      "POST /api/v1/spaces/{spaceId}/expenses": () =>
        jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201),
    });
    renderWithIntl(
      <RecordForm
        space={householdSpace()}
        accounts={[]}
        groups={[groupDto()]}
        formats={BUILT_IN_FORMATS}
        initialKind="EXPENSE"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={{
          members: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" })],
          meMemberId: "m-ana",
          myAccounts: [BANK],
          funds: [],
        }}
        api={api}
      />,
    );
    await chooseCurrency(/^Dólar estadounidense/);
    await userEvent.type(screen.getByLabelText("Monto"), "50");
    const card = await screen.findByRole("group", { name: "Tu Bancolombia en COP pagó" });
    await waitFor(() => expect(within(card).getByText("205.000 COP")).toBeInTheDocument());
    await save();
    expect(await posted(requests)).toMatchObject({
      amount: { amount: "5000", currency: "USD" },
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: { amount: "5000", currency: "USD" } }],
      accountAmount: { amount: "20500000", currency: "COP" },
    });
  });
});

describe("transfer across currencies (D29, board 10)", () => {
  it("asks what leaves (Sale) and what arrives (Llega) and sends the destination amount", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/transfers": () => jsonResponse(transactionDto({ id: "t-x" }), 201),
    });
    form(api, "TRANSFER", [CHASE, BANK]);
    // A transfer's amount stays in its source account's currency, so it offers no currency of its own.
    expect(screen.queryByRole("button", { name: /^Moneda: / })).toBeNull();
    await userEvent.type(screen.getByLabelText("Monto"), "100");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Bancolombia/ }));
    await userEvent.type(screen.getByLabelText("Llega"), "400000");
    await save("transferencia");
    expect(await posted(requests)).toMatchObject({
      amount: { amount: "10000", currency: "USD" },
      destinationAmount: { amount: "40000000", currency: "COP" },
      sourceAccountId: "a-chase",
      destinationAccountId: "a-bank",
    });
  });
});

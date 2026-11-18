import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  accountDto,
  cop,
  householdSpace,
  memberDto,
  money,
  normalized,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalancesScreen } from "./balances-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T17:00:00Z"));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const ANA = memberDto();
const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const TRIP = householdSpace({ id: "sp-trip", name: "Viaje 2026", role: "MEMBER" });
/** Ruling P342 (S4): Juan owes Ana in three currencies, none converted into another. */
const DEBTS = [cop(500_000), money(50, "USD"), money(60, "EUR")];
const BALANCES = [
  { memberId: "m-ana", net: cop(500_000), nets: DEBTS },
  {
    memberId: "m-juan",
    net: cop(-500_000),
    nets: DEBTS.map((debt) => ({ ...debt, amount: `-${debt.amount}` })),
  },
];
const SUGGESTIONS = DEBTS.map((amount) => ({ payerMemberId: "m-juan", receivingMemberId: "m-ana", amount }));
const inUsd = (overrides: Partial<AccountDto>) =>
  accountDto({ ...overrides, openingBalance: money(0, "USD"), balance: money(0, "USD") });
const BANK = accountDto({ id: "a-bank", name: "Bancolombia", ownerUserId: "u-ana" });
const CHASE = inUsd({ id: "a-chase", name: "Chase", ownerUserId: "u-ana" });
const DAVI = accountDto({ id: "a-davi", name: "Davivienda", ownerUserId: "u-juan" });
const settled = () => jsonResponse(transactionDto({ id: "t-s", type: "SETTLEMENT" }), 201);
const RATE = { rate: "4100", on: "2026-10-31", converted: cop(205_000) };

const screenAs = (
  meUserId: string,
  api: Api,
  props: Partial<Parameters<typeof BalancesScreen>[0]> = {},
  locale: "es" | "en" = "es",
) =>
  renderWithIntl(
    <BalancesScreen
      space={TRIP}
      members={[ANA, JUAN]}
      meUserId={meUserId}
      balances={BALANCES}
      suggestions={SUGGESTIONS}
      myAccounts={meUserId === "u-juan" ? [DAVI] : [BANK, CHASE]}
      formats={BUILT_IN_FORMATS}
      personalSpaceId="sp-personal"
      timeZone="America/Bogota"
      api={api}
      {...props}
    />,
    { locale },
  );

/** An accessible name whose spaces match the formatters' non-breaking ones. */
const named = (text: string) => new RegExp(`^${text.replace(/[.()$]/g, "\\$&").replace(/ /g, "\\s")}$`);
const suggestion = (amount: string) =>
  screen.getByRole("button", { name: named(`Saldar: Juan le paga ${amount} a Ana`) });
const dialog = () => screen.getByRole("dialog", { name: "Saldar" });
const amountField = () => within(dialog()).getByLabelText("Monto");
const legField = (label: "Te pagó" | "Pagaste") => within(dialog()).getByLabelText(label);
const rates = (requests: Request[]) =>
  requests
    .filter((r) => new URL(r.url).pathname === "/api/v1/exchange-rates")
    .map((r) => Object.fromEntries(new URL(r.url).searchParams));
const server = (handlers: Record<string, FakeHandler> = {}) =>
  fakeApi({
    "GET /api/v1/exchange-rates": () => jsonResponse(RATE),
    "POST /api/v1/spaces/{spaceId}/settlements": settled,
    ...handlers,
  });

// The sheet loads in a chunk of its own (#296): it is resolved once here, as the screen does once that chunk is in.
beforeAll(async () => {
  const { unmount } = screenAs("u-ana", fakeApi({}).api, { settle: "m-juan" });
  await screen.findByRole("dialog", { name: "Saldar" });
  unmount();
});

describe("Saldar settles in the debt's currency (ruling P342, S5)", () => {
  it("prefills a USD suggestion in USD, lands it in Ana's USD account and records it in USD", async () => {
    const { api, requests } = server();
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    expect(amountField()).toHaveValue("50");
    // Money in dollars arrives in an account in dollars: the account in pesos is not offered for it.
    const row = within(dialog()).getByRole("button", { name: /^Llega a:/ });
    expect(row).toHaveAccessibleName("Llega a: Chase");
    await userEvent.click(row);
    const to = within(dialog()).getByRole("radiogroup", { name: "Llega a (opcional)" });
    expect(within(to).queryByRole("radio", { name: "Bancolombia" })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(await requests.at(-1)!.json()).toEqual({
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      amount: { amount: "5000", currency: "USD" },
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
      destinationAccountId: "a-chase",
    });
  });

  it("chooses which of Juan's debts to settle, starting on the one tapped", async () => {
    const { api, requests } = server();
    screenAs("u-ana", api);
    await userEvent.click(suggestion("500.000 COP"));
    const debts = within(dialog()).getByRole("radiogroup", { name: "Qué deuda saldas" });
    expect(
      within(debts)
        .getAllByRole("radio")
        .map((radio) => normalized(radio.textContent)),
    ).toEqual(["500.000 COP", "50 USD", "60 EUR"]);
    expect(within(debts).getByRole("radio", { name: named("500.000 COP") })).toBeChecked();
    await userEvent.click(within(debts).getByRole("radio", { name: named("60 EUR") }));
    expect(amountField()).toHaveValue("60");
    // Ana has no account in euros: the payment arrives in none.
    expect(within(dialog()).queryByRole("button", { name: /^Llega a:/ })).toBeNull();
    // Each other currency she may have received it in has its own link.
    expect(
      within(dialog())
        .getAllByRole("button", { name: /^Te pagó en/ })
        .map((link) => link.textContent),
    ).toEqual(["Te pagó en peso colombiano", "Te pagó en dólar estadounidense"]);
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    const body = await requests.at(-1)!.json();
    expect(body).toMatchObject({ amount: { amount: "6000", currency: "EUR" } });
    expect(body).not.toHaveProperty("destinationAccountId");
  });

  it("leaves a single-currency Saldar as it was: no debt choice, no other currency", async () => {
    const { api } = server();
    screenAs("u-ana", api, {
      balances: [
        { memberId: "m-ana", net: cop(500_000) },
        { memberId: "m-juan", net: cop(-500_000) },
      ],
      suggestions: [SUGGESTIONS[0]!],
      myAccounts: [BANK],
    });
    await userEvent.click(suggestion("500.000 COP"));
    expect(within(dialog()).queryByRole("radiogroup", { name: "Qué deuda saldas" })).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Te pagó en/ })).toBeNull();
  });
});

describe("Saldar in another currency, as an explicit exchange (ruling P342, S5, board 3)", () => {
  it("settles 50 USD with 205.000 COP received into Ana's account in pesos", async () => {
    const { api, requests } = server();
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    // The figure is the server's conversion of 50 USD at the day's rate: the app never rounds money itself.
    await waitFor(() => expect(legField("Te pagó")).toHaveValue("205.000"));
    expect(rates(requests)).toContainEqual({ base: "USD", quote: "COP", on: "2026-10-31", amount: "5000" });
    expect(normalized(within(dialog()).getByText(/^Saldas/).textContent)).toBe(
      "Saldas 50 USD · Juan te pagó en peso colombiano",
    );
    expect(normalized(within(dialog()).getByTestId("exchange-equals").textContent)).toBe("50 USD =");
    expect(normalized(within(dialog()).getByTestId("exchange-summary").textContent)).toBe(
      "Juan queda debiendo 500.000 COP y 60 EUR. Los 50 USD quedan saldados; Bancolombia sube 205.000 COP.",
    );
    expect(
      within(dialog()).getByRole("button", { name: "Te pagó en dólar estadounidense" }),
    ).toBeInTheDocument();
    await userEvent.click(
      within(dialog()).getByRole("button", { name: named("Saldar 50 USD con 205.000 COP") }),
    );
    expect(await requests.at(-1)!.json()).toEqual({
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      amount: { amount: "5000", currency: "USD" },
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
      destinationAccountId: "a-bank",
      destinationAmount: { amount: "20500000", currency: "COP" },
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("records what Ana typed instead of the suggestion, and goes back to dollars with its link", async () => {
    const { api, requests } = server();
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    await waitFor(() => expect(legField("Te pagó")).toHaveValue("205.000"));
    await userEvent.clear(legField("Te pagó"));
    await userEvent.type(legField("Te pagó"), "200.000");
    await userEvent.click(
      within(dialog()).getByRole("button", { name: named("Saldar 50 USD con 200.000 COP") }),
    );
    expect(await requests.at(-1)!.json()).toMatchObject({
      amount: { amount: "5000", currency: "USD" },
      destinationAmount: { amount: "20000000", currency: "COP" },
    });
  });

  it("goes back to settling in dollars, with nothing exchanged", async () => {
    const { api, requests } = server();
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en dólar estadounidense" }));
    expect(amountField()).toHaveValue("50");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    const body = await requests
      .filter((r) => r.method === "POST")
      .at(-1)!
      .json();
    expect(body).not.toHaveProperty("destinationAmount");
    expect(body).toMatchObject({ amount: { currency: "USD" }, destinationAccountId: "a-chase" });
  });

  it("sends what left Juan's account in pesos when he is the one who pays", async () => {
    const { api, requests } = server();
    screenAs("u-juan", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Pagaste en peso colombiano" }));
    await waitFor(() => expect(legField("Pagaste")).toHaveValue("205.000"));
    expect(normalized(within(dialog()).getByTestId("exchange-summary").textContent)).toBe(
      "Quedas debiendo 500.000 COP y 60 EUR. Los 50 USD quedan saldados; Davivienda baja 205.000 COP.",
    );
    await userEvent.click(
      within(dialog()).getByRole("button", { name: named("Saldar 50 USD con 205.000 COP") }),
    );
    expect(await requests.at(-1)!.json()).toMatchObject({
      amount: { amount: "5000", currency: "USD" },
      sourceAccountId: "a-davi",
      sourceAmount: { amount: "20500000", currency: "COP" },
    });
  });

  it("shows the day's rate alone when the server sends no conversion, and records what Ana types", async () => {
    const { api, requests } = server({
      "GET /api/v1/exchange-rates": () => jsonResponse({ rate: "4100.5", on: "2026-10-30" }),
    });
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    await waitFor(() =>
      expect(legField("Te pagó")).toHaveAccessibleDescription(/Tasa del día: 1\sUSD = 4\.100,5\sCOP\./),
    );
    expect(legField("Te pagó")).toHaveValue("");
    await userEvent.type(legField("Te pagó"), "205.000");
    await userEvent.click(
      within(dialog()).getByRole("button", { name: named("Saldar 50 USD con 205.000 COP") }),
    );
    expect(await requests.at(-1)!.json()).toMatchObject({
      destinationAmount: { amount: "20500000", currency: "COP" },
    });
  });

  it("asks for the figure when there is no rate for the day", async () => {
    const { api } = server({
      "GET /api/v1/exchange-rates": () => problemResponse(404, "ExchangeRateNotFound"),
    });
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    await waitFor(() => expect(legField("Te pagó")).toHaveAccessibleDescription(/No hay tasa del día/));
    expect(legField("Te pagó")).toHaveValue("");
  });

  it("offers settling in dollars or creating an account in pesos when Ana has none (owner: Pedir una cuenta)", async () => {
    const { api, requests } = server();
    screenAs("u-ana", api, { myAccounts: [CHASE] });
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    expect(
      within(dialog()).getByText(
        "Para saldar en peso colombiano necesitas una cuenta tuya en peso colombiano, donde queda el cambio.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByLabelText("Te pagó")).toBeNull();
    expect(
      within(dialog()).getByRole("link", { name: "Crear una cuenta en peso colombiano" }),
    ).toHaveAttribute(
      "href",
      `/spaces/sp-personal/accounts/new?returnTo=${encodeURIComponent("/spaces/sp-trip/balances?settle=m-juan")}`,
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Saldar en dólar estadounidense" }));
    expect(amountField()).toHaveValue("50");
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(0);
  });

  it.each([
    ["ExchangeAccountRequired", "Para saldar en otra moneda necesitas una cuenta tuya en esa moneda."],
    ["ExchangeRateRequired", "No hay tasa de cambio para esa fecha entre estas monedas."],
    ["CurrencyMismatch", "Ese monto no está en la moneda que corresponde. Revisa la moneda."],
  ])("shows %s from the API in place, under what Ana received", async (code, message) => {
    const { api } = server({ "POST /api/v1/spaces/{spaceId}/settlements": () => problemResponse(422, code) });
    screenAs("u-ana", api);
    await userEvent.click(suggestion("50 USD"));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Te pagó en peso colombiano" }));
    await waitFor(() => expect(legField("Te pagó")).toHaveValue("205.000"));
    await userEvent.click(
      within(dialog()).getByRole("button", { name: named("Saldar 50 USD con 205.000 COP") }),
    );
    await waitFor(() => expect(legField("Te pagó")).toBeInvalid());
    expect(legField("Te pagó")).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("reads in English with no accessibility violations", async () => {
    const { api } = server();
    screenAs("u-ana", api, {}, "en");
    await userEvent.click(screen.getByRole("button", { name: named("Settle: Juan pays Ana 50 USD") }));
    const sheet = screen.getByRole("dialog", { name: "Settle" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Paid you in Colombian Peso" }));
    await waitFor(() => expect(within(sheet).getByLabelText("Paid you")).toHaveValue("205.000"));
    expect(
      within(sheet).getByRole("button", { name: named("Settle 50 USD with 205.000 COP") }),
    ).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);
  });
});

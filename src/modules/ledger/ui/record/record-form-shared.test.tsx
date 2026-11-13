import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  guestDto,
  householdSpace,
  memberDto,
  normalized,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { SharedExpenseContext } from "../split/shared-context";
import { handOver } from "./record-carry";
import { RecordForm } from "./record-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-01T04:30:00Z"));
});
afterEach(() => vi.useRealTimers());

const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
});
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];

const HOUSEHOLD = householdSpace();
const MEMBERS = [
  memberDto(),
  memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
];
const BANK = accountDto({ id: "a-bank", name: "Bancolombia" });
const context = (members = MEMBERS, funds: AccountDto[] = []): SharedExpenseContext => ({
  members,
  meMemberId: "m-ana",
  myAccounts: [BANK],
  funds,
});
const equal = (amount: string, members = MEMBERS) =>
  jsonResponse({
    method: "EQUAL",
    availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
    lineId: null,
    shares: members.map((m) => ({
      memberId: m.id,
      amount: { amount: String(BigInt(amount) / BigInt(members.length)), currency: "COP" },
    })),
  });
const planned = () =>
  jsonResponse({
    method: "BY_ALLOCATION",
    availableMethods: ["BY_ALLOCATION", "EQUAL", "PERCENT", "EXACT", "SHARES"],
    lineId: "l-home",
    shares: [
      { memberId: "m-ana", amount: { amount: "80000000", currency: "COP" } },
      { memberId: "m-juan", amount: { amount: "120000000", currency: "COP" } },
    ],
  });
const amountOf = (request: Request) => new URL(request.url).searchParams.get("amount")!;
const recordedAt = () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201);
const form = (api: Api, shared = context()) =>
  renderWithIntl(
    <RecordForm
      space={HOUSEHOLD}
      accounts={[]}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind="EXPENSE"
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      shared={shared}
      api={api}
    />,
  );
const enter = async (pesos: string) => {
  await userEvent.type(screen.getByLabelText("Monto"), pesos);
  await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
  await userEvent.click(await screen.findByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("radio", { name: "Sin subcategoría" }));
};
const divisionRow = () => screen.getByRole("button", { name: /División/ });
// The sheet is a lazily imported chunk: it exists only after the import resolves, so it is awaited, never assumed.
const splitSheet = () => screen.findByRole("dialog", { name: "Cómo se divide" });
// Ruling P324 (S6): who paid and the account it left have a sheet of their own, opened from the "Quién pagó" row.
const payerSheet = () => screen.findByRole("dialog", { name: "Quién pagó" });

describe("the account a shared expense is paid from (issue #208)", () => {
  afterEach(() => localStorage.clear());
  const SAVINGS = accountDto({ id: "a-savings", name: "Ahorros", type: "SAVINGS" });
  const VISA = accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" });
  const payer = () => screen.getByRole("button", { name: /Pagas tú|Pagó/ });

  it("is never a savings account while the recorder has another one, when nothing was paid yet", () => {
    form(fakeApi({}).api, { ...context(), myAccounts: [SAVINGS, BANK] });
    expect(payer()).toHaveTextContent("Pagó Ana desde Bancolombia");
  });

  it("is the account the recorder paid from last", () => {
    localStorage.setItem("hearth.lastAccount", "a-visa");
    form(fakeApi({}).api, { ...context(), myAccounts: [SAVINGS, BANK, VISA] });
    expect(payer()).toHaveTextContent("Pagó Ana desde Visa");
  });

  it("is remembered from a shared expense the recorder paid", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    form(api);
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(localStorage.getItem("hearth.lastAccount")).toBe("a-bank");
  });

  it("is not remembered from an expense the fund paid", async () => {
    localStorage.setItem("hearth.lastAccount", "a-visa");
    const fund = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    form(api, { ...context(MEMBERS, [fund]), myAccounts: [BANK, VISA] });
    await enter("300000");
    await userEvent.click(payer());
    await userEvent.click(await screen.findByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(localStorage.getItem("hearth.lastAccount")).toBe("a-visa");
  });
});

describe("shared expense (HU-E9-06)", () => {
  it("splits 300,000 COP equally between Ana and Juan, paid from Bancolombia, and records it once", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    const { container } = form(api);
    expect(screen.queryByRole("button", { name: /^Cuenta/ })).not.toBeInTheDocument();
    await enter("300000");
    expect(screen.getByRole("button", { name: /Pagas tú|Pagó/ })).toHaveTextContent(
      "Pagó Ana desde Bancolombia",
    );
    await waitFor(() =>
      expect(normalized(divisionRow().textContent)).toContain("Con Ana y Juan · mitad y mitad"),
    );
    await userEvent.dblClick(screen.getByRole("button", { name: "Guardar gasto" }));
    const posted = requests.filter((r) => r.method === "POST");
    expect(posted).toHaveLength(1);
    const body = await posted[0]!.json();
    expect(body).toMatchObject({
      categoryId: "c-groceries",
      amount: { amount: "30000000", currency: "COP" },
      payments: [{ memberId: "m-ana", accountId: "a-bank", amount: { amount: "30000000", currency: "COP" } }],
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
    expect(body).not.toHaveProperty("accountId");
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household/transactions", { scroll: false });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("goes to the list with the fund's warning when the fund went negative, once, with the expense saved", async () => {
    const fund = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": () =>
        jsonResponse(
          {
            ...transactionDto({ id: "t-new" }),
            warnings: [
              {
                code: "FundBalanceNegative",
                accountId: "a-fund",
                balance: { amount: "-50000000", currency: "COP" },
              },
            ],
          },
          201,
        ),
    });
    form(api, context(MEMBERS, [fund]));
    await enter("2000000");
    await userEvent.click(screen.getByRole("button", { name: /Pagas tú|Pagó/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        "/spaces/sp-household/transactions?notice=FundBalanceNegative&account=a-fund",
        { scroll: false },
      ),
    );
    // The warning is not an error: the expense was recorded (201) and the form shows no problem.
    expect(requests.filter((r) => r.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("offers the guest Pedro as a payer and as a participant next to Ana and Luis, and no other member as payer", async () => {
    const members = [
      memberDto(),
      memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" }),
      guestDto(),
    ];
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r), members),
    });
    form(api, context(members));
    await enter("90000");
    await userEvent.click(screen.getByRole("button", { name: /Pagas tú|Pagó/ }));
    const payers = await payerSheet();
    expect(
      within(within(payers).getByRole("radiogroup", { name: "Pagó" }))
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Ana (tú)", "Pedro (invitado)"]);
    // The payer sheet holds one decision: no method, nobody to tick.
    expect(within(payers).queryByRole("radiogroup", { name: "Cómo se divide" })).not.toBeInTheDocument();
    expect(within(payers).queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.click(within(payers).getByRole("button", { name: "Listo" }));
    await userEvent.click(divisionRow());
    const sheet = await splitSheet();
    expect(within(sheet).queryByRole("radiogroup", { name: "Pagó" })).not.toBeInTheDocument();
    expect(
      within(sheet)
        .getAllByRole("checkbox")
        .map((c) => c.closest("li")!.getAttribute("aria-labelledby")),
    ).toEqual(["split-name-m-ana", "split-name-m-luis", "split-name-m-pedro"]);
  });

  it("keeps the save button disabled while 10 % of the split is unassigned", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
    });
    form(api);
    await enter("300000");
    await userEvent.click(divisionRow());
    const sheet = await splitSheet();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Porcentaje" }));
    // Porcentaje starts from equal shares and fills in Juan (issue #177): Juan's 50 is typed last, over it.
    await userEvent.clear(within(sheet).getByLabelText("Valor de Ana (tú)"));
    await userEvent.type(within(sheet).getByLabelText("Valor de Ana (tú)"), "40");
    await userEvent.clear(within(sheet).getByLabelText("Valor de Juan"));
    await userEvent.type(within(sheet).getByLabelText("Valor de Juan"), "50");
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeDisabled();
    expect(normalized(divisionRow().textContent)).toContain("Falta asignar 10 %");
  });

  it("preselects the plan's split, sends no split for it, and lets the person switch to equal parts", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": planned,
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    form(api);
    await enter("2000000");
    await waitFor(() =>
      expect(normalized(divisionRow().textContent)).toContain("Con Ana y Juan · según el plan"),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const body = await requests.find((r) => r.method === "POST")!.json();
    expect(body).not.toHaveProperty("split");
    expect(body.payments).toHaveLength(1);

    await userEvent.click(divisionRow());
    await userEvent.click(within(await splitSheet()).getByRole("radio", { name: "Iguales" }));
    await userEvent.keyboard("{Escape}");
    expect(normalized(divisionRow().textContent)).toContain("Con Ana y Juan · mitad y mitad");
  });

  it("never lets a later default undo the method the person chose", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/default-split": planned });
    form(api);
    await enter("2000000");
    await waitFor(() => expect(normalized(divisionRow().textContent)).toContain("según el plan"));
    await userEvent.click(divisionRow());
    await userEvent.click(within(await splitSheet()).getByRole("radio", { name: "Iguales" }));
    await userEvent.keyboard("{Escape}");
    // The amount changes, so a new default is asked for and answered: the chosen method stays.
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await new Promise((done) => setTimeout(done, 450));
    expect(normalized(divisionRow().textContent)).toContain("mitad y mitad");
  });

  it("goes back to equal parts when the plan's split can no longer be asked", async () => {
    let asked = 0;
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        ++asked === 1 ? planned() : problemResponse(500, "InternalError"),
    });
    form(api);
    await enter("2000000");
    await waitFor(() => expect(normalized(divisionRow().textContent)).toContain("según el plan"));
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await waitFor(() =>
      expect(normalized(divisionRow().textContent)).toContain("Con Ana y Juan · mitad y mitad"),
    );
  });

  it("shows the API's split problem under the split row and lets the person fix it", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidSplit"),
    });
    form(api);
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Revisa cómo se divide el gasto.")).toBeInTheDocument();
    expect(divisionRow()).toHaveAccessibleDescription("Revisa cómo se divide el gasto.");
  });

  it("clears the split problem as soon as the split changes (390 px review, S3)", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidSplit"),
    });
    form(api);
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(await screen.findByText("Revisa cómo se divide el gasto.")).toBeInTheDocument();
    await userEvent.click(divisionRow());
    const sheet = await splitSheet();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Juan" }));
    expect(screen.queryByText("Revisa cómo se divide el gasto.")).toBeNull();
  });

  it("shows no error on the division row for a method nobody has typed a value for yet (S2)", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
    });
    form(api);
    await enter("300000");
    await userEvent.click(divisionRow());
    const sheet = await splitSheet();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Porcentaje" }));
    // The sheet is open over the form, so the row is reached past the dialog's hidden background.
    const row = () => screen.getByRole("button", { name: /División/, hidden: true });
    expect(normalized(row().textContent)).toContain("Con Ana y Juan · por porcentaje");
    expect(row()).not.toHaveTextContent("Revisa el valor");
    await userEvent.type(within(sheet).getByLabelText("Valor de Ana (tú)"), "x");
    await userEvent.clear(within(sheet).getByLabelText("Valor de Ana (tú)"));
    expect(row()).toHaveTextContent("Revisa el valor de Ana (tú)");
  });

  it("summarises a split of three as a count, and one of two as the names (U2)", async () => {
    const LUIS = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });
    const three = [...MEMBERS, LUIS];
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r), three),
    });
    form(api, context(three));
    await enter("300000");
    await waitFor(() =>
      expect(normalized(divisionRow().textContent)).toContain("Con 3 personas · partes iguales"),
    );
    await userEvent.click(divisionRow());
    const sheet = within(await splitSheet());
    await userEvent.click(sheet.getByRole("checkbox", { name: "Luis" }));
    await userEvent.keyboard("{Escape}");
    expect(normalized(divisionRow().textContent)).toContain("Con Ana y Juan · mitad y mitad");
  });

  it("shows a payment problem under the same rows, not the account picker that is not there", async () => {
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "AccountNotOwned"),
    });
    form(api);
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(
      await screen.findByText("Solo el dueño de esa cuenta puede registrar movimientos con ella."),
    ).toBeInTheDocument();
  });

  it("records a fund payment with no payer member", async () => {
    const fund = accountDto({
      id: "a-fund",
      name: "Fondo Hogar",
      type: "SHARED_FUND",
      ownerUserId: null,
    });
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    form(api, context(MEMBERS, [fund]));
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: /Pagas tú|Pagó/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(screen.getByRole("button", { name: /Pagas tú|Pagó/ })).toHaveTextContent("Pagó Fondo Hogar");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect((await requests.find((r) => r.method === "POST")!.json()).payments).toEqual([
      { memberId: null, accountId: "a-fund", amount: { amount: "30000000", currency: "COP" } },
    ]);
  });

  it("chooses who paid and the account in the payer sheet, outside the split sheet, and sends the same request (P324, S6)", async () => {
    const VISA = accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" });
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    form(api, { ...context(), myAccounts: [BANK, VISA] });
    await enter("300000");
    // Board "Registrar gasto": how it is split, then who paid, then the date, each a row with its meta.
    const payerRow = screen.getByRole("button", { name: "Pagó Ana desde Bancolombia" });
    expect(payerRow).toHaveTextContent("Quién pagó");
    expect(divisionRow()).toHaveTextContent("Cómo se divide");
    expect(divisionRow().compareDocumentPosition(payerRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(
      payerRow.compareDocumentPosition(screen.getByTestId("when-chip")) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // The split sheet no longer offers the payer or the account.
    await userEvent.click(divisionRow());
    const split = await splitSheet();
    expect(within(split).queryByRole("radiogroup", { name: "Pagó" })).not.toBeInTheDocument();
    expect(within(split).queryByRole("radiogroup", { name: "Desde" })).not.toBeInTheDocument();
    await userEvent.click(within(split).getByRole("button", { name: "Listo" }));
    await userEvent.click(payerRow);
    const payers = await payerSheet();
    await userEvent.click(
      within(within(payers).getByRole("radiogroup", { name: "Desde" })).getByRole("radio", { name: "Visa" }),
    );
    await userEvent.click(within(payers).getByRole("button", { name: "Listo" }));
    expect(screen.getByRole("button", { name: "Pagó Ana desde Visa" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const body = await requests.find((r) => r.method === "POST")!.json();
    expect(body).toMatchObject({
      payments: [{ memberId: "m-ana", accountId: "a-visa", amount: { amount: "30000000", currency: "COP" } }],
      split: { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] },
    });
    expect(body).not.toHaveProperty("accountId");
  });

  it("asks for the account under the Quién pagó row when the recorder has none to pay from", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
    });
    form(api, { ...context(), myAccounts: [] });
    await enter("300000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    expect(screen.getByRole("button", { name: /^Pagó Ana/ })).toHaveAccessibleDescription(
      "Elige una cuenta.",
    );
    expect(divisionRow()).not.toHaveAccessibleDescription(/Elige una cuenta/);
    expect(requests.filter((r) => r.method === "POST")).toEqual([]);
  });

  // D25 (owner's ruling, 2026-10-27): a shared space holds only its fund, so it records expenses and contributions to
  // the fund, never an income or a transfer between its own accounts (ruling P321 for the record sheet).
  const FUND = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
  const withFund = (api: Api, initialKind: "EXPENSE" | "INCOME" | "TRANSFER", funds = [FUND]) =>
    renderWithIntl(
      <RecordForm
        space={HOUSEHOLD}
        accounts={funds}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind={initialKind}
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={context(MEMBERS, funds)}
        api={api}
      />,
    );

  it("offers a shared space an expense and a contribution to its fund, never an income (D25, P321)", () => {
    withFund(fakeApi({}).api, "INCOME");
    expect(screen.getByRole("tab", { name: "Gasto" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Transferencia" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Ingreso" })).toBeNull();
  });

  it("records a transfer as a contribution from the recorder's own account into the fund (P321)", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/fund-contributions": () =>
        jsonResponse(transactionDto({ id: "t-new", type: "TRANSFER", payerMemberId: "m-ana" }), 201),
    });
    withFund(api, "EXPENSE");
    await userEvent.click(screen.getByRole("tab", { name: "Transferencia" }));
    // Desde lists the recorder's own accounts, Hacia the space's fund (its only one, already chosen).
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Bancolombia");
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveTextContent("Fondo Hogar");
    await userEvent.type(screen.getByLabelText("Monto"), "100000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
    const post = requests.find((r) => r.method === "POST")!;
    expect(new URL(post.url).pathname).toBe(`/api/v1/spaces/${HOUSEHOLD.id}/fund-contributions`);
    expect(await post.json()).toMatchObject({
      sourceAccountId: "a-bank",
      fundAccountId: "a-fund",
      amount: { amount: "10000000", currency: "COP" },
    });
  });

  it("offers a shared space without a fund the contribution too, and Hacia creates the fund and comes back (P321)", async () => {
    withFund(fakeApi({}).api, "EXPENSE", []);
    await userEvent.click(screen.getByRole("tab", { name: "Transferencia" }));
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = await screen.findByRole("dialog", { name: "Hacia" });
    expect(to).toHaveTextContent("Este espacio aún no tiene un fondo. Crea uno para recibir los aportes.");
    const create = within(to).getByRole("link", { name: "Crear un fondo" });
    const back = new URL(create.getAttribute("href")!, "http://hearth.test");
    expect(back.pathname).toBe("/spaces/sp-household/accounts/new");
    expect(back.searchParams.get("returnTo")).toBe("/spaces/sp-household/new?type=transfer");
  });

  // RDD advisory on P321: Crear un fondo hands over the account chosen in Desde, so the return starts from it.
  const VISA = accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" });
  const contribution = (funds: AccountDto[]) =>
    renderWithIntl(
      <RecordForm
        space={HOUSEHOLD}
        accounts={funds}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="TRANSFER"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={{ ...context(MEMBERS, funds), myAccounts: [BANK, VISA] }}
        api={fakeApi({}).api}
      />,
    );

  it("comes back from Crear un fondo with the account chosen in Desde (P321)", async () => {
    const { unmount } = contribution([]);
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Bancolombia");
    await userEvent.click(screen.getByRole("button", { name: /Desde/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Visa/ }));
    await userEvent.type(screen.getByLabelText("Monto"), "100000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = await screen.findByRole("dialog", { name: "Hacia" });
    await userEvent.click(within(to).getByRole("link", { name: "Crear un fondo" }));
    unmount();
    // The fund now exists, and the form for the same space starts from what was typed and chosen.
    contribution([FUND]);
    expect(screen.getByLabelText("Monto")).toHaveValue("100.000");
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Visa");
    expect(screen.getByRole("button", { name: /Hacia/ })).toHaveTextContent("Fondo Hogar");
  });

  it("never restores a handed-over account that is not one of the recorder's own (P321)", () => {
    handOver(HOUSEHOLD.id, {
      kind: "TRANSFER",
      amount: "",
      description: "",
      when: null,
      accountId: "a-elsewhere",
    });
    contribution([FUND]);
    expect(screen.getByRole("button", { name: /Desde/ })).toHaveTextContent("Bancolombia");
  });

  it("tells a member without a fund who creates one, with no link they could not use (P321)", async () => {
    renderWithIntl(
      <RecordForm
        space={householdSpace({ role: "MEMBER" })}
        accounts={[]}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="TRANSFER"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={context(MEMBERS, [])}
        api={fakeApi({}).api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = await screen.findByRole("dialog", { name: "Hacia" });
    expect(to).toHaveTextContent(
      "Este espacio aún no tiene un fondo. Pídele a quien lo administra que cree uno.",
    );
    expect(within(to).queryByRole("link")).toBeNull();
  });

  it("offers a direct space only the expense: it holds no accounts (P321)", () => {
    renderWithIntl(
      <RecordForm
        space={householdSpace({ kind: "DIRECT", name: "Ana & Pedro" })}
        accounts={[]}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="TRANSFER"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={context(MEMBERS, [])}
        api={fakeApi({}).api}
      />,
    );
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar gasto" })).toBeInTheDocument();
  });
});

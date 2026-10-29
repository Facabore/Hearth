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
import { RecordForm } from "./record-form";

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
// Issue #171: the split is folded under Más opciones until it is opened.
const openMore = () => userEvent.click(screen.getByRole("button", { name: "Más opciones" }));
const enter = async (pesos: string) => {
  await userEvent.type(screen.getByLabelText("Monto"), pesos);
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
  await openMore();
};
const divisionRow = () => screen.getByRole("button", { name: /División/ });
// The sheet is a lazily imported chunk: it exists only after the import resolves, so it is awaited, never assumed.
const splitSheet = () => screen.findByRole("dialog", { name: "Quién pagó y para quién" });

describe("the account a shared expense is paid from (issue #208)", () => {
  afterEach(() => localStorage.clear());
  const SAVINGS = accountDto({ id: "a-savings", name: "Ahorros", type: "SAVINGS" });
  const VISA = accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD" });
  const payer = () => screen.getByRole("button", { name: /Pagas tú|Pagó/ });

  it("is never a savings account while the recorder has another one, when nothing was paid yet", () => {
    form(fakeApi({}).api, { ...context(), myAccounts: [SAVINGS, BANK] });
    expect(payer()).toHaveTextContent("Pagas tú desde Bancolombia (tu cuenta personal)");
  });

  it("is the account the recorder paid from last", () => {
    localStorage.setItem("hearth.lastAccount", "a-visa");
    form(fakeApi({}).api, { ...context(), myAccounts: [SAVINGS, BANK, VISA] });
    expect(payer()).toHaveTextContent("Pagas tú desde Visa (tu cuenta personal)");
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
      "Pagas tú desde Bancolombia (tu cuenta personal)",
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
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household/transactions");
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
    const sheet = await splitSheet();
    expect(
      within(within(sheet).getByRole("radiogroup", { name: "Pagó" }))
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Ana (tú)", "Pedro (invitado)"]);
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

  it("keeps an income on the single account picker in a shared space", () => {
    const { api } = fakeApi({});
    renderWithIntl(
      <RecordForm
        space={HOUSEHOLD}
        accounts={[BANK]}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        initialKind="INCOME"
        initialNow="2026-11-01T04:30:00.000Z"
        timeZone="America/Bogota"
        shared={context()}
        api={api}
      />,
    );
    expect(screen.getByRole("button", { name: /Cuenta que recibe/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pagas tú|Pagó/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /División/ })).not.toBeInTheDocument();
  });
});

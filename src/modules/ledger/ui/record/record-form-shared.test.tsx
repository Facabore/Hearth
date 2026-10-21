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
const enter = async (pesos: string) => {
  await userEvent.type(screen.getByLabelText("Monto"), pesos);
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
};
const divisionRow = () => screen.getByRole("button", { name: /División/ });
const splitSheet = () => screen.getByRole("dialog", { name: "Quién pagó y para quién" });

describe("shared expense (HU-E9-06)", () => {
  it("splits 300,000 COP equally between Ana and Juan, paid from Bancolombia, and records it once", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": (r) => equal(amountOf(r)),
      "POST /api/v1/spaces/{spaceId}/expenses": recordedAt,
    });
    const { container } = form(api);
    expect(screen.queryByRole("button", { name: /^Cuenta/ })).not.toBeInTheDocument();
    await enter("300000");
    expect(screen.getByRole("button", { name: /Pagó/ })).toHaveTextContent("Pagó Ana (tú) desde Bancolombia");
    await waitFor(() =>
      expect(normalized(divisionRow().textContent)).toContain(
        "Iguales · Ana (tú) $ 150.000 · Juan $ 150.000",
      ),
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
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/transactions");
    expect(await axeViolations(container)).toEqual([]);
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
    await userEvent.click(screen.getByRole("button", { name: /Pagó/ }));
    const sheet = splitSheet();
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
    const sheet = splitSheet();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Porcentaje" }));
    await userEvent.type(within(sheet).getByLabelText("Valor de Ana (tú)"), "40");
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
      expect(normalized(divisionRow().textContent)).toContain(
        "Según el plan · Ana (tú) $ 800.000 · Juan $ 1.200.000",
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    const body = await requests.find((r) => r.method === "POST")!.json();
    expect(body).not.toHaveProperty("split");
    expect(body.payments).toHaveLength(1);

    await userEvent.click(divisionRow());
    await userEvent.click(within(splitSheet()).getByRole("radio", { name: "Iguales" }));
    await userEvent.keyboard("{Escape}");
    expect(normalized(divisionRow().textContent)).toContain(
      "Iguales · Ana (tú) $ 1.000.000 · Juan $ 1.000.000",
    );
  });

  it("never lets a later default undo the method the person chose", async () => {
    const { api } = fakeApi({ "GET /api/v1/spaces/{spaceId}/default-split": planned });
    form(api);
    await enter("2000000");
    await waitFor(() => expect(normalized(divisionRow().textContent)).toContain("Según el plan"));
    await userEvent.click(divisionRow());
    await userEvent.click(within(splitSheet()).getByRole("radio", { name: "Iguales" }));
    await userEvent.keyboard("{Escape}");
    // The amount changes, so a new default is asked for and answered: the chosen method stays.
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await new Promise((done) => setTimeout(done, 450));
    expect(normalized(divisionRow().textContent)).toContain("Iguales");
  });

  it("goes back to equal parts when the plan's split can no longer be asked", async () => {
    let asked = 0;
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        ++asked === 1 ? planned() : problemResponse(500, "InternalError"),
    });
    form(api);
    await enter("2000000");
    await waitFor(() => expect(normalized(divisionRow().textContent)).toContain("Según el plan"));
    await userEvent.type(screen.getByLabelText("Monto"), "0");
    await waitFor(() =>
      expect(normalized(divisionRow().textContent)).toContain(
        "Iguales · Ana (tú) $ 10.000.000 · Juan $ 10.000.000",
      ),
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
    await userEvent.click(screen.getByRole("button", { name: /Pagó/ }));
    await userEvent.click(screen.getByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(screen.getByRole("button", { name: /Pagó/ })).toHaveTextContent("Pagó Fondo Hogar");
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
    expect(screen.queryByRole("button", { name: /Pagó/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /División/ })).not.toBeInTheDocument();
  });
});

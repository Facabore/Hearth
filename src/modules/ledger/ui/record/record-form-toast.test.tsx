import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  memberDto,
  spaceDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { Person } from "../direct/counterparts";
import type { SharedExpenseContext } from "../split/shared-context";
import { RecordForm, type RecordFormProps } from "./record-form";
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
  key: "groceries",
  subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
});
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries] })];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia", type: "BANK" }),
  accountDto({ id: "a-visa", name: "Visa", type: "CREDIT_CARD", icon: "card" }),
];
const PERSONAL = spaceDto();
const inProvider = (ui: ReactElement) => renderWithIntl(<ToastProvider>{ui}</ToastProvider>);
const form = (api: Api, kind: RecordKind = "EXPENSE", extra: Partial<RecordFormProps> = {}) =>
  inProvider(
    <RecordForm
      space={PERSONAL}
      accounts={accounts}
      groups={groups}
      formats={BUILT_IN_FORMATS}
      initialKind={kind}
      initialNow="2026-11-01T04:30:00.000Z"
      timeZone="America/Bogota"
      api={api}
      {...extra}
    />,
  );
const recorded = () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201);
const chooseGroceries = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
  await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
};
const saved = (text: string) => waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(text));

describe("record form save feedback (ruling P196)", () => {
  it("announces Gasto guardado after a save, in a status region that was empty before", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Market");
    await chooseGroceries();
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await saved("Gasto guardado");
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${PERSONAL.id}/transactions`);
  });

  it("announces Ingreso guardado on the incomes endpoint", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/incomes": recorded });
    form(api, "INCOME");
    await userEvent.type(screen.getByLabelText("Monto"), "1.200.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ingreso" }));
    await saved("Ingreso guardado");
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${PERSONAL.id}/transactions`);
  });

  it("announces Transferencia guardada on the transfers endpoint", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/transfers": recorded });
    form(api, "TRANSFER");
    await userEvent.type(screen.getByLabelText("Monto"), "200000");
    await userEvent.click(screen.getByRole("button", { name: /Hacia/ }));
    const to = screen.getByRole("dialog", { name: "Hacia" });
    await userEvent.click(within(to).getByRole("radio", { name: /Visa/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar transferencia" }));
    await saved("Transferencia guardada");
  });

  it("announces Gasto guardado after a split with someone", async () => {
    const people: Person[] = [
      { memberId: "m-juan-d", name: "Juan", isGuest: false, directSpace: "Ana & Juan" },
    ];
    const { api } = fakeApi({
      "POST /api/v1/direct-splits": () =>
        jsonResponse(
          {
            spaceId: "sp-ana-juan",
            created: false,
            expense: { ...transactionDto({ id: "t-1" }), warnings: [] },
          },
          201,
        ),
    });
    form(api, "EXPENSE", { people });
    await userEvent.type(screen.getByLabelText("Monto"), "120000");
    await chooseGroceries();
    await userEvent.click(screen.getByRole("button", { name: "Dividir con alguien" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Juan/ }));
    await userEvent.click(screen.getByRole("button", { name: "Seguir con Juan" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    await saved("Gasto guardado");
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-ana-juan/transactions");
  });

  it("goes back to the screen it was recorded from, and Ver opens the movement (issue #172)", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/expenses": recorded });
    form(api, "EXPENSE", { returnTo: `/spaces/${PERSONAL.id}?period=2026-10` });
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      `/spaces/${PERSONAL.id}?period=2026-10`,
    );
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await chooseGroceries();
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await saved("Gasto guardado");
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${PERSONAL.id}?period=2026-10`);
    await userEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(router.push).toHaveBeenCalledWith(`/spaces/${PERSONAL.id}/transactions?tx=t-new`);
  });

  it("ignores a returnTo that leaves the app and lands on the list (issue #172)", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/incomes": recorded });
    form(api, "INCOME", { returnTo: "//evil.example" });
    await userEvent.type(screen.getByLabelText("Monto"), "1.200.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar ingreso" }));
    await saved("Ingreso guardado");
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${PERSONAL.id}/transactions`);
  });

  it("goes back after a split with someone, and Ver opens it in the direct space (issue #172)", async () => {
    const people: Person[] = [
      { memberId: "m-juan-d", name: "Juan", isGuest: false, directSpace: "Ana & Juan" },
    ];
    const { api } = fakeApi({
      "POST /api/v1/direct-splits": () =>
        jsonResponse(
          {
            spaceId: "sp-ana-juan",
            created: false,
            expense: { ...transactionDto({ id: "t-1" }), warnings: [] },
          },
          201,
        ),
    });
    form(api, "EXPENSE", { people, returnTo: `/spaces/${PERSONAL.id}` });
    await userEvent.type(screen.getByLabelText("Monto"), "120000");
    await chooseGroceries();
    await userEvent.click(screen.getByRole("button", { name: "Dividir con alguien" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Juan/ }));
    await userEvent.click(screen.getByRole("button", { name: "Seguir con Juan" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar y dividir" }));
    await saved("Gasto guardado");
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${PERSONAL.id}`);
    await userEvent.click(screen.getByRole("button", { name: "Ver" }));
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-ana-juan/transactions?tx=t-1");
  });

  it("stays silent when the request fails, so nothing claims a save that did not happen", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/expenses": () => problemResponse(422, "InvalidDescription"),
    });
    form(api);
    await userEvent.type(screen.getByLabelText("Monto"), "85000");
    await chooseGroceries();
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await screen.findByText("La descripción puede tener hasta 200 caracteres.");
    expect(router.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("stays silent when the saved-with-warning notice speaks (P170)", async () => {
    const HOUSEHOLD = householdSpace();
    const MEMBERS = [
      memberDto(),
      memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
    ];
    const fund = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
    const shared: SharedExpenseContext = {
      members: MEMBERS,
      meMemberId: "m-ana",
      myAccounts: [accountDto({ id: "a-bank", name: "Bancolombia" })],
      funds: [fund],
    };
    const { api } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": () =>
        jsonResponse({
          method: "EQUAL",
          availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
          lineId: null,
          shares: MEMBERS.map((m) => ({ memberId: m.id, amount: { amount: "100000000", currency: "COP" } })),
        }),
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
    form(api, "EXPENSE", { space: HOUSEHOLD, accounts: [], shared });
    await userEvent.type(screen.getByLabelText("Monto"), "2000000");
    await chooseGroceries();
    await userEvent.click(screen.getByRole("button", { name: /Pagas tú|Pagó/ }));
    await userEvent.click(await screen.findByRole("radio", { name: "Fondo Hogar" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        `/spaces/${HOUSEHOLD.id}/transactions?notice=FundBalanceNegative&account=a-fund`,
      ),
    );
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

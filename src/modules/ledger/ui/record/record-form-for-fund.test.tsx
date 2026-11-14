import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  memberDto,
  transactionDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { SharedExpenseContext } from "../split/shared-context";
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

const rent = categoryDto({ id: "c-rent", name: "Arriendo" });
const groups = [groupDto({ id: "g-home", name: "Vivienda", categories: [rent] })];
const MEMBERS = [
  memberDto(),
  memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
];
const BANK = accountDto({ id: "a-bank", name: "Bancolombia" });
const FUND = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
const context = (funds: AccountDto[]): SharedExpenseContext => ({
  members: MEMBERS,
  meMemberId: "m-ana",
  myAccounts: [BANK],
  funds,
});
/** The default split of Arriendo's line, which `payers` usually pay (D26); a fund line unless `lineFunding` says. */
const rentLine =
  (payers: string[] | undefined, lineFunding: "SHARED_FUND" | "DIRECT" = "SHARED_FUND") =>
  () =>
    jsonResponse({
      method: "EQUAL",
      availableMethods: ["EQUAL", "PERCENT", "EXACT", "SHARES"],
      lineId: "l-rent",
      ...(payers === undefined ? {} : { payerMemberIds: payers, lineFunding }),
      shares: null,
    });
const recorded = () => jsonResponse({ ...transactionDto({ id: "t-new" }), warnings: [] }, 201);
const form = (api: Api, shared: SharedExpenseContext) =>
  renderWithIntl(
    <RecordForm
      space={householdSpace()}
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
const enter = async () => {
  await userEvent.type(screen.getByLabelText("Monto"), "1200000");
  await userEvent.click(screen.getByRole("button", { name: "Elegir categoría" }));
  await userEvent.click(await screen.findByRole("radio", { name: "Arriendo" }));
};
const payerRow = () => screen.getByRole("button", { name: /Pagas tú|Pagó|Pagaste/ });
const posted = async (requests: Request[]) => {
  await userEvent.click(screen.getByRole("button", { name: "Guardar gasto" }));
  await waitFor(() => expect(requests.some((r) => r.method === "POST")).toBe(true));
  return requests.find((r) => r.method === "POST")!.json();
};

describe("Registrar proposes who usually pays the line (D26, P328)", () => {
  it("starts Ana, who pays Arriendo, as paying for the fund from Bancolombia, and records it for the fund", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": rentLine(["m-ana"]),
      "POST /api/v1/spaces/{spaceId}/expenses": recorded,
    });
    const { container } = form(api, context([FUND]));
    await enter();
    await waitFor(() => expect(payerRow()).toHaveTextContent("Pagaste por Fondo Hogar desde Bancolombia"));
    const body = await posted(requests);
    expect(body.paidForFund).toEqual({ fundAccountId: "a-fund", sourceAccountId: "a-bank" });
    expect(body).not.toHaveProperty("payments");
    expect(localStorage.getItem("hearth.lastAccount")).toBe("a-bank");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lets Ana choose to pay herself instead, as before", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": rentLine(["m-ana"]),
      "POST /api/v1/spaces/{spaceId}/expenses": recorded,
    });
    form(api, context([FUND]));
    await enter();
    await waitFor(() => expect(payerRow()).toHaveTextContent("Pagaste por Fondo Hogar"));
    await userEvent.click(payerRow());
    const sheet = await screen.findByRole("dialog", { name: "Quién pagó" });
    expect(sheet).toHaveTextContent("Lo que pagaste cuenta como tu aporte a Fondo Hogar.");
    await userEvent.click(screen.getByRole("radio", { name: "Ana (tú)" }));
    await userEvent.click(screen.getByRole("button", { name: "Listo" }));
    expect(payerRow()).toHaveTextContent("Pagó Ana desde Bancolombia");
    const body = await posted(requests);
    expect(body.payments).toEqual([
      { memberId: "m-ana", accountId: "a-bank", amount: { amount: "120000000", currency: "COP" } },
    ]);
    expect(body).not.toHaveProperty("paidForFund");
  });

  it("keeps Ana as who paid when Juan pays the line, when nobody does, or without a fund (S5)", async () => {
    for (const [payers, funds] of [
      [["m-juan"], [FUND]],
      [undefined, [FUND]],
      [["m-ana"], []],
    ] as const) {
      const { api, requests } = fakeApi({
        "GET /api/v1/spaces/{spaceId}/default-split": rentLine(
          payers === undefined ? undefined : [...payers],
        ),
        "POST /api/v1/spaces/{spaceId}/expenses": recorded,
      });
      const { unmount } = form(api, context([...funds]));
      await enter();
      await waitFor(() => expect(requests.some((r) => r.url.includes("default-split"))).toBe(true));
      expect(payerRow()).toHaveTextContent("Pagó Ana desde Bancolombia");
      const body = await posted(requests);
      expect(body.payments).toEqual([
        { memberId: "m-ana", accountId: "a-bank", amount: { amount: "120000000", currency: "COP" } },
      ]);
      unmount();
    }
  });

  it("keeps Ana as who paid for a DIRECT line she pays, even in a space with a fund (D26, S5)", async () => {
    const { api, requests } = fakeApi({
      "GET /api/v1/spaces/{spaceId}/default-split": rentLine(["m-ana"], "DIRECT"),
      "POST /api/v1/spaces/{spaceId}/expenses": recorded,
    });
    form(api, context([FUND]));
    await enter();
    await waitFor(() => expect(requests.some((r) => r.url.includes("default-split"))).toBe(true));
    // Let the answer land before reading who paid.
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(payerRow()).toHaveTextContent("Pagó Ana desde Bancolombia");
    const body = await posted(requests);
    expect(body).not.toHaveProperty("paidForFund");
    expect(body.payments).toEqual([
      { memberId: "m-ana", accountId: "a-bank", amount: { amount: "120000000", currency: "COP" } },
    ]);
  });
});

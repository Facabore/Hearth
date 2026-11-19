import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { accountDto, cop, meDto, memberDto, transactionDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import type { Locale } from "@/i18n/locale";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import type { SharedExpenseContext } from "../split/shared-context";
import { EditPaymentForm } from "./edit-payment-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn(), back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T23:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const PATCH = "PATCH /api/v1/spaces/{spaceId}/transactions/{transactionId}";
const LIST = "/spaces/sp-household/transactions?period=2026-11";
const shared: SharedExpenseContext = {
  members: [
    memberDto({ id: "m-ana", userId: "u-ana", displayName: "Ana" }),
    memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" }),
    memberDto({ id: "m-sofia", userId: "u-sofia", displayName: "Sofía", role: "MEMBER" }),
  ],
  meMemberId: "m-ana",
  myAccounts: [
    accountDto({ id: "a-bank", name: "Bancolombia" }),
    accountDto({ id: "a-nequi", name: "Nequi" }),
  ],
  funds: [],
};
/** Board 1: Juan paid Ana 947.000 COP; Ana recorded it, Juan's side has no account, Ana's arrived in Bancolombia. */
const paid = transactionDto({
  id: "t-pay",
  type: "SETTLEMENT",
  description: "",
  amount: cop(947_000),
  date: "2026-11-12",
  occurredAt: "2026-11-13T02:41:00.000Z",
  timeZone: "America/Bogota",
  payerMemberId: "m-juan",
  receivingMemberId: "m-ana",
  sourceAccountId: null,
  destinationAccountId: "a-bank",
  version: 4,
});

const renderForm = (api: Api, tx: TransactionDto = paid, locale: Locale = "es", pick?: "out" | "in") =>
  renderWithIntl(
    <ToastProvider>
      <EditPaymentForm
        spaceId="sp-household"
        tx={tx}
        shared={shared}
        me={meDto({ timezone: "America/Bogota" })}
        origin={LIST}
        api={api}
        {...(pick ? { pick } : {})}
      />
    </ToastProvider>,
    { locale },
  );
const save = () => userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
const choose = async (row: RegExp, sheetName: string, option: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: row }));
  const sheet = screen.getByRole("dialog", { name: sheetName });
  await userEvent.click(within(sheet).getByRole("radio", { name: option }));
};

describe("edit a payment between members (P344, board 1)", () => {
  it("names both sides: each member with a picker, the editor's own account with one, the other's as theirs to choose", async () => {
    const { container } = renderForm(fakeApi({}).api);
    expect(screen.getByRole("heading", { name: "Editar pago" })).toBeInTheDocument();
    expect(screen.getByText("Juan le pagó a Ana")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quién pagó/ })).toHaveTextContent("Juan");
    // Juan's side: nobody but Juan chooses his account, so it is no button.
    expect(screen.getByText("Sin asignar")).toBeInTheDocument();
    expect(screen.getByText("Sale de · solo Juan elige su cuenta")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sale de/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quién recibió/ })).toHaveTextContent("Ana (tú)");
    expect(screen.getByRole("button", { name: /Llega a/ })).toHaveTextContent("Bancolombia");
    expect(screen.getByLabelText("Monto")).toHaveValue("947.000");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sends the new payer and no account for a side moved to another member (S3, S4)", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...paid, version: 5 }) });
    renderForm(api);
    await choose(/Quién pagó/, "Quién pagó", /Sofía/);
    expect(screen.getByText("Sofía le pagó a Ana")).toBeInTheDocument();
    expect(screen.getByText("Sale de · solo Sofía elige su cuenta")).toBeInTheDocument();
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(requests[0]!.headers.get("if-match")).toBe('"4"');
    expect(await requests[0]!.json()).toEqual({ payerMemberId: "m-sofia" });
  });

  it("never offers the other side's member, so the two stay distinct", async () => {
    renderForm(fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: /Quién pagó/ }));
    const sheet = screen.getByRole("dialog", { name: "Quién pagó" });
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Juan", "Sofía"]);
  });

  it("lets the editor pick their own account on their own side, and sends only it (S2)", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...paid, version: 5 }) });
    renderForm(api);
    await choose(/Llega a/, "Llega a", /Nequi/);
    expect(screen.getByRole("button", { name: /Llega a/ })).toHaveTextContent("Nequi");
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({ destinationAccountId: "a-nequi" });
  });

  it("gives the editor who becomes the payer their own account picker, and sends the account they chose", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...paid, version: 5 }) });
    // Sofía recorded it as Juan paying Sofía; Ana corrects it: she paid Sofía, from Nequi.
    renderForm(api, { ...paid, receivingMemberId: "m-sofia", destinationAccountId: "a-sofia" });
    expect(screen.getByText("Cuenta de Sofía")).toBeInTheDocument();
    expect(screen.getByText("Llega a · solo Sofía la cambia")).toBeInTheDocument();
    await choose(/Quién pagó/, "Quién pagó", /Ana/);
    await choose(/Sale de/, "Sale de", /Nequi/);
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    // Sofía's side keeps her account: only the member moved, and nobody sends hers.
    expect(await requests[0]!.json()).toEqual({ payerMemberId: "m-ana", sourceAccountId: "a-nequi" });
  });

  it("sends nothing and goes back to the sheet when nothing changed", async () => {
    const { api, requests } = fakeApi({});
    renderForm(api);
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`${LIST}&tx=t-pay`, { scroll: false }));
    expect(requests).toHaveLength(0);
  });

  it("sends a new amount in the payment's currency", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...paid, version: 5 }) });
    renderForm(api);
    await userEvent.clear(screen.getByLabelText("Monto"));
    await userEvent.type(screen.getByLabelText("Monto"), "950000");
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({ amount: { amount: "95000000", currency: "COP" } });
  });

  it("reads the same in English", () => {
    renderForm(fakeApi({}).api, paid, "en");
    expect(screen.getByRole("heading", { name: "Edit payment" })).toBeInTheDocument();
    expect(screen.getByText("Juan paid Ana")).toBeInTheDocument();
    expect(screen.getByText("Leaves from · only Juan chooses their account")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save changes" })).toBeInTheDocument();
  });

  it("opens without a sheet when no side is asked for", () => {
    renderForm(fakeApi({}).api);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens the editor's own account picker for the side the detail asked for, and saves the account chosen (S6)", async () => {
    const { api, requests } = fakeApi({ [PATCH]: () => jsonResponse({ ...paid, version: 5 }) });
    const mine = { ...paid, payerMemberId: "m-ana", receivingMemberId: "m-juan", destinationAccountId: null };
    renderForm(api, mine, "es", "out");
    const sheet = await screen.findByRole("dialog", { name: "Sale de" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /Nequi/ }));
    await save();
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({ sourceAccountId: "a-nequi" });
  });

  it("never opens a picker for a side that is someone else's", () => {
    renderForm(fakeApi({}).api, paid, "es", "out");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

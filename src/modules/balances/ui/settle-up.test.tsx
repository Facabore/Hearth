import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  accountDto,
  cop,
  guestDto,
  householdSpace,
  memberDto,
  normalized,
  transactionDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalancesScreen } from "./balances-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T17:00:00Z"));
});
afterEach(() => vi.useRealTimers());

const ANA = memberDto();
const JUAN = memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" });
const LUIS = memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" });
const net = (memberId: string, pesos: number) => ({ memberId, net: cop(pesos) });

const TRIP = householdSpace({ id: "sp-trip", name: "Viaje 2026", role: "MEMBER" });
const MEMBERS = [ANA, JUAN, LUIS, guestDto()];
const TRIP_BALANCES = [
  net("m-ana", 150_000),
  net("m-juan", -100_000),
  net("m-luis", -50_000),
  net("m-pedro", 0),
];
const SUGGESTIONS = [
  { payerMemberId: "m-juan", receivingMemberId: "m-ana", amount: cop(100_000) },
  { payerMemberId: "m-luis", receivingMemberId: "m-ana", amount: cop(50_000) },
];
const DAVI = accountDto({ id: "a-davi", name: "Davivienda", ownerUserId: "u-juan" });
const BANK = accountDto({ id: "a-bank", name: "Bancolombia", ownerUserId: "u-ana" });
const settled = () => jsonResponse(transactionDto({ id: "t-s", type: "SETTLEMENT" }), 201);
const screenAs = (
  meUserId: string,
  api: Api,
  settle?: string,
  props: Partial<Parameters<typeof BalancesScreen>[0]> = {},
  locale: "es" | "en" = "es",
) =>
  renderWithIntl(
    <BalancesScreen
      space={TRIP}
      members={MEMBERS}
      meUserId={meUserId}
      balances={TRIP_BALANCES}
      suggestions={SUGGESTIONS}
      myAccounts={meUserId === "u-juan" ? [DAVI] : [BANK]}
      formats={BUILT_IN_FORMATS}
      settle={settle}
      timeZone="America/Bogota"
      api={api}
      {...props}
    />,
    { locale },
  );
/** The screen as the signed-in layout mounts it: inside the toast provider. */
const juanInToasts = (api: Api) =>
  renderWithIntl(
    <ToastProvider>
      <BalancesScreen
        space={TRIP}
        members={MEMBERS}
        meUserId="u-juan"
        balances={TRIP_BALANCES}
        suggestions={SUGGESTIONS}
        myAccounts={[DAVI]}
        formats={BUILT_IN_FORMATS}
        timeZone="America/Bogota"
        api={api}
      />
    </ToastProvider>,
  );
const dialog = () => screen.getByRole("dialog", { name: "Registrar pago" });
const payerGroup = () => within(dialog()).getByRole("radiogroup", { name: "Quién paga" });
const save = () => within(dialog()).getByRole("button", { name: "Guardar pago" });
/** An accessible name whose spaces match the formatters' non-breaking ones. */
const named = (text: string) => new RegExp(`^${text.replace(/[.()$]/g, "\\$&").replace(/ /g, "\\s")}$`);
const JUAN_PAYS = named("Liquidar: Juan le paga $ 100.000 a Ana");
const LUIS_PAYS = named("Liquidar: Luis le paga $ 50.000 a Ana");

describe("settle up (HU-E9-07, rulings P174 and P175)", () => {
  it("prefills the form from Juan's suggestion and records 100,000 COP from Juan to Ana once", async () => {
    // The answer waits for the double tap: a real one lands long before the network replies.
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": async () => {
        await answered;
        return settled();
      },
    });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    expect(within(payerGroup()).getByRole("radio", { name: "Juan (tú)" })).toBeChecked();
    expect(
      within(within(dialog()).getByRole("radiogroup", { name: "Quién recibe" })).getByRole("radio", {
        name: "Ana",
      }),
    ).toBeChecked();
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("100.000");
    expect(normalized(within(dialog()).getByText(/le debe/).textContent)).toContain(
      "Juan le debe $ 100.000 a Ana. Puedes registrar un pago parcial; si pagas de más, la deuda cambia de lado.",
    );
    // Prefilling records nothing by itself.
    expect(requests).toHaveLength(0);
    await userEvent.dblClick(save());
    expect(save()).toBeDisabled();
    expect(requests).toHaveLength(1);
    answer();
    expect(requests[0]!.headers.get("idempotency-key")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await requests[0]!.json()).toEqual({
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      amount: { amount: "10000000", currency: "COP" },
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // A double tap records one payment, not one that merely arrived first.
    expect(requests).toHaveLength(1);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("ignores a second submit while the first is still on its way, even from the keyboard", async () => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => (answer = resolve));
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": async () => {
        await answered;
        return settled();
      },
    });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    const form = dialog().querySelector("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(requests).toHaveLength(1));
    answer();
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);
  });

  it("sends the same Idempotency-Key when an unchanged draft is retried after a failure", async () => {
    let attempts = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": () =>
        ++attempts === 1 ? problemResponse(500, "InternalError") : settled(),
    });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    await userEvent.click(save());
    await within(dialog()).findByRole("alert");
    await userEvent.click(save());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.headers.get("idempotency-key")).toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("uses a fresh key once the draft has changed", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": () => problemResponse(500, "InternalError"),
    });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    await userEvent.click(save());
    await within(dialog()).findByRole("alert");
    await userEvent.clear(within(dialog()).getByLabelText("Monto"));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "40.000");
    await userEvent.click(save());
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]!.headers.get("idempotency-key")).not.toBe(requests[0]!.headers.get("idempotency-key"));
  });

  it("records a partial payment of 50,000 COP from the viewer's own account", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    await userEvent.clear(within(dialog()).getByLabelText("Monto"));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "50.000");
    await userEvent.click(within(dialog()).getByRole("radio", { name: "Davivienda" }));
    await userEvent.click(save());
    expect(await requests[0]!.json()).toMatchObject({
      amount: { amount: "5000000" },
      sourceAccountId: "a-davi",
    });
  });

  it("shows the amount's format, drops a letter and still records the payment (#164)", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    const amount = within(dialog()).getByLabelText("Monto");
    await userEvent.clear(amount);
    expect(amount).toHaveAccessibleDescription("Ej: 1.250,50");
    await userEvent.type(amount, "5x0000");
    expect(amount).toHaveValue("50.000");
    await userEvent.click(within(dialog()).getByRole("radio", { name: "Davivienda" }));
    await userEvent.click(save());
    expect(await requests[0]!.json()).toMatchObject({
      amount: { amount: "5000000" },
      sourceAccountId: "a-davi",
    });
  });

  it("announces Pago registrado in the status toast once the payment is saved (P196)", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    juanInToasts(api);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    await userEvent.click(save());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Pago registrado"));
  });

  it("says nothing when the payment is refused", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": () => problemResponse(500, "InternalError"),
    });
    juanInToasts(api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    await userEvent.click(save());
    await within(dialog()).findByRole("alert");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("hides the source account when the guest Pedro pays, and records the payment without one", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-ana", api);
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await userEvent.click(within(payerGroup()).getByRole("radio", { name: "Pedro (invitado)" }));
    expect(
      within(dialog()).getByText("Pedro es invitado: pagó fuera de la app, así que no hay cuenta de origen."),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("radiogroup", { name: "Sale de (opcional)" }),
    ).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("radiogroup", { name: "Llega a (opcional)" })).toBeInTheDocument();
    expect(normalized(within(dialog()).getByText(/no le debe nada/).textContent)).toBe(
      "Pedro no le debe nada a Ana.",
    );
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "100.000");
    await userEvent.click(save());
    const body = await requests[0]!.json();
    expect(body).toMatchObject({
      payerMemberId: "m-pedro",
      receivingMemberId: "m-ana",
      amount: { amount: "10000000" },
    });
    expect(body).not.toHaveProperty("sourceAccountId");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("offers the receiving account only when the viewer receives, and sends the one chosen", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-ana", api);
    await userEvent.click(screen.getByRole("button", { name: LUIS_PAYS }));
    expect(
      within(dialog()).queryByRole("radiogroup", { name: "Sale de (opcional)" }),
    ).not.toBeInTheDocument();
    const to = within(dialog()).getByRole("radiogroup", { name: "Llega a (opcional)" });
    expect(within(to).getByRole("radio", { name: "Ninguna" })).toBeChecked();
    await userEvent.click(within(to).getByRole("radio", { name: "Bancolombia" }));
    await userEvent.click(save());
    expect(await requests[0]!.json()).toMatchObject({
      payerMemberId: "m-luis",
      receivingMemberId: "m-ana",
      destinationAccountId: "a-bank",
    });
  });

  it("does not offer a receiving account when somebody else receives", async () => {
    screenAs("u-juan", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    expect(
      within(dialog()).queryByRole("radiogroup", { name: "Llega a (opcional)" }),
    ).not.toBeInTheDocument();
    expect(within(dialog()).getByRole("radiogroup", { name: "Sale de (opcional)" })).toBeInTheDocument();
  });

  it("refuses a payment to oneself without sending it", async () => {
    const { api, requests } = fakeApi({});
    screenAs("u-ana", api);
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await userEvent.click(within(payerGroup()).getByRole("radio", { name: "Ana (tú)" }));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "1.000");
    await userEvent.click(save());
    expect(
      within(dialog()).getByText("Quien paga y quien recibe deben ser personas distintas."),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("asks who pays, then for a readable amount, before sending anything", async () => {
    const { api, requests } = fakeApi({});
    screenAs("u-ana", api);
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    await userEvent.click(save());
    expect(within(dialog()).getByText("Elige quién paga.")).toBeInTheDocument();
    await userEvent.click(within(payerGroup()).getByRole("radio", { name: "Luis" }));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "cien");
    await userEvent.click(save());
    expect(within(dialog()).getByLabelText("Monto")).toHaveAccessibleDescription(/Escribe un monto como/);
    expect(requests).toHaveLength(0);
  });

  it("shows an API problem next to its field and keeps the sheet open", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": () => problemResponse(422, "InvalidAmount"),
    });
    screenAs("u-juan", api);
    await userEvent.click(screen.getByRole("button", { name: JUAN_PAYS }));
    await userEvent.click(save());
    await waitFor(() => expect(within(dialog()).getByLabelText("Monto")).toBeInvalid());
    expect(router.refresh).not.toHaveBeenCalled();
    expect(save()).toBeEnabled();
  });

  it("opens prefilled for the member named by ?settle=", () => {
    screenAs("u-ana", fakeApi({}).api, "m-luis");
    expect(within(payerGroup()).getByRole("radio", { name: "Luis" })).toBeChecked();
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("50.000");
  });

  it("opens for ?settle= a guest without a suggestion, with the viewer receiving and no amount", () => {
    screenAs("u-ana", fakeApi({}).api, "m-pedro");
    expect(within(payerGroup()).getByRole("radio", { name: "Pedro (invitado)" })).toBeChecked();
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("");
  });

  it("takes ?settle= out of the address, replacing the entry, once the payment is saved (N8)", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    screenAs("u-ana", api, "m-luis");
    await userEvent.click(save());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${TRIP.id}/balances`);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("takes ?settle= out of the address when the sheet is closed without saving, so a reload does not reopen it (N8)", async () => {
    screenAs("u-ana", fakeApi({}).api, "m-luis");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith(`/spaces/${TRIP.id}/balances`);
  });

  it("leaves the address alone when the sheet was opened by a button, not by ?settle= (N8)", async () => {
    screenAs("u-ana", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: LUIS_PAYS }));
    await userEvent.keyboard("{Escape}");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("ignores a ?settle= that is not a current member", () => {
    screenAs("u-ana", fakeApi({}).api, "m-nobody");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("starts every opening from its own prefill", async () => {
    screenAs("u-ana", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: LUIS_PAYS }));
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("50.000");
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "1");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Registrar pago" }));
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("");
    expect(within(payerGroup()).queryByRole("radio", { checked: true })).toBeNull();
  });

  it("gives a viewer the balances without any settle-up control", () => {
    screenAs("u-ana", fakeApi({}).api, "m-luis", { space: { ...TRIP, role: "VIEWER" } });
    expect(screen.queryByRole("button", { name: /Liquidar/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar pago" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reads in English with no accessibility violations", async () => {
    screenAs("u-juan", fakeApi({}).api, undefined, {}, "en");
    await userEvent.click(screen.getByRole("button", { name: named("Settle: Juan pays Ana $ 100.000") }));
    const sheet = screen.getByRole("dialog", { name: "Record a payment" });
    expect(within(sheet).getByRole("radiogroup", { name: "Who pays" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Save payment" })).toBeInTheDocument();
    expect(normalized(within(sheet).getByText(/owes/).textContent)).toBe(
      "Juan owes Ana $ 100.000. You can record a partial payment; paying more turns the debt around.",
    );
    expect(await axeViolations(sheet)).toEqual([]);
  });
});

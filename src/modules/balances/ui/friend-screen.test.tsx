import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  cop,
  friendDto,
  guestDto,
  invitationDto,
  memberDto,
  normalized,
  spaceDto,
} from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { BalanceHistoryDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { FriendScreen } from "./friend-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const TODAY = "2026-11-16";
const DIRECT = spaceDto({ id: "sp-mama", name: "Mamá", kind: "DIRECT", role: "OWNER" });
const ANA = memberDto({ id: "m-ana-mama" });
const MAMA = guestDto({ id: "m-mama", displayName: "Mamá" });

type Entry = BalanceHistoryDto["entries"][number];
const entry = (id: string, date: string, description: string, pesos: number, more: Partial<Entry> = {}) =>
  ({
    transactionId: id,
    type: "EXPENSE",
    date,
    description,
    change: cop(pesos),
    balance: cop(0),
    ...more,
  }) as Entry;

/** Ana's history with Mamá, oldest first as the API answers it. */
const HISTORY: BalanceHistoryDto = {
  memberId: "m-ana-mama",
  from: null,
  to: null,
  opening: cop(0),
  closing: cop(500_000),
  entries: [
    entry("t-loan", "2025-03-12", "Préstamo", 500_000),
    entry("t-market", "2026-08-14", "Mercado", 100_000),
    entry("t-abono", "2026-11-02", "Abono", -100_000, {
      type: "SETTLEMENT",
      settlementReason: "PAYMENT",
      payerMemberId: "m-mama",
      receivingMemberId: "m-ana-mama",
    }),
  ],
};

const view = (props: Partial<Parameters<typeof FriendScreen>[0]> = {}, locale: "es" | "en" = "es") =>
  renderWithIntl(
    <ToastProvider>
      <FriendScreen
        personalSpaceId="sp-personal"
        friend={friendDto()}
        space={DIRECT}
        members={[ANA, MAMA]}
        meUserId="u-ana"
        balances={[
          { memberId: "m-ana-mama", net: cop(500_000) },
          { memberId: "m-mama", net: cop(-500_000) },
        ]}
        suggestions={[{ payerMemberId: "m-mama", receivingMemberId: "m-ana-mama", amount: cop(500_000) }]}
        history={HISTORY}
        formats={BUILT_IN_FORMATS}
        today={TODAY}
        timeZone="America/Bogota"
        api={fakeApi({}).api}
        {...(props as object)}
      />
    </ToastProvider>,
    { locale },
  );

/** A row's text with its spaces and the amount's word joiner read plainly. */
const plain = (text: string | null | undefined) => normalized(text).replace(/⁠/g, "");
const rows = () =>
  within(screen.getByRole("region", { name: "Entre tú y Mamá" }))
    .getAllByRole("listitem")
    .map((row) => plain(row.textContent));

describe('a person of Amigos (ruling P338, board "Amigo · Mom")', () => {
  it("shows a guest's balance in words, the way back to Amigos and every movement between the two, newest first", async () => {
    const { container } = view();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/balances",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Mamá" })).toBeInTheDocument();
    expect(screen.getByText("No usa Hearth")).toBeInTheDocument();
    const balance = screen.getByRole("region", { name: "Mamá te debe" });
    expect(plain(balance.textContent)).toBe("Mamá te debe$ 500.000");
    expect(rows()).toEqual([
      "Abono2 nov · Mamá te pagó−$ 100.000",
      "Mercado14 ago · tú pagaste · su parte+$ 100.000",
      "Préstamo12 mar 2025 · tú pagaste · su parte+$ 500.000",
    ]);
    expect(
      screen.getByText("Solo ustedes dos ven esto. No se mezcla con tus grupos ni con tus gastos."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Registrar con Mamá" })).toHaveAttribute(
      "href",
      `/spaces/sp-mama/new?returnTo=${encodeURIComponent("/spaces/sp-personal/friends/sp-mama")}`,
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names a registered person by the apodo and says their own name under it, with no invitation", () => {
    view({
      friend: friendDto({
        other: { memberId: "m-mama", kind: "USER", displayName: "Lucía Gómez", nickname: "Mamá" },
      }),
      members: [ANA, memberDto({ id: "m-mama", userId: "u-lucia", displayName: "Lucía Gómez" })],
    });
    expect(screen.getByText("Lucía Gómez")).toBeInTheDocument();
    expect(screen.queryByText("No usa Hearth")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
  });

  it("says who owes when it is the viewer, and that they are al día", () => {
    const { unmount } = view({
      friend: friendDto({ net: cop(-120_000) }),
      balances: [{ memberId: "m-ana-mama", net: cop(-120_000) }],
    });
    expect(screen.getByRole("region", { name: "Le debes a Mamá" })).toBeInTheDocument();
    unmount();
    view({ friend: friendDto({ net: cop(0) }), balances: [], suggestions: [] });
    expect(screen.getByRole("region", { name: "Estás al día con Mamá" })).toBeInTheDocument();
  });

  it("renames a guest from Apodo, saving the name the person typed", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/me/friends/{spaceId}": () =>
        jsonResponse({ spaceId: "sp-mama", other: friendDto().other, name: "Mami" }),
    });
    view({ api });
    await userEvent.click(screen.getByRole("button", { name: "Apodo de Mamá" }));
    const sheet = await screen.findByRole("dialog", { name: "Apodo de Mamá" });
    const field = within(sheet).getByRole("textbox", { name: "Apodo" });
    expect(field).toHaveValue("Mamá");
    await userEvent.clear(field);
    await userEvent.type(field, "  Mami ");
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/me/friends/sp-mama");
    expect(await requests[0]!.json()).toEqual({ nickname: "Mami" });
  });

  it("clears a registered person's apodo with an empty field, which goes back to their name", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/me/friends/{spaceId}": () =>
        jsonResponse({ spaceId: "sp-mama", other: friendDto().other, name: "Lucía Gómez" }),
    });
    view({
      api,
      friend: friendDto({
        other: { memberId: "m-mama", kind: "USER", displayName: "Lucía Gómez", nickname: "Mamá" },
      }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Apodo de Mamá" }));
    const sheet = await screen.findByRole("dialog", { name: "Apodo de Mamá" });
    expect(within(sheet).getByText(/Solo tú lo ves/)).toBeInTheDocument();
    await userEvent.clear(within(sheet).getByRole("textbox", { name: "Apodo" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(await requests[0]!.json()).toEqual({ nickname: null });
  });

  it("opens Saldos' settle-up sheet for the two from Saldar, with the suggestion filled in", async () => {
    view();
    await userEvent.click(screen.getByRole("button", { name: "Saldar" }));
    const sheet = await screen.findByRole("dialog", { name: "Saldar" });
    expect(within(sheet).getByRole("textbox", { name: /Monto/ })).toHaveValue("500.000");
  });

  it("invites a guest to Hearth with a single-use claim link", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links": () =>
        jsonResponse(
          {
            invitation: invitationDto({ kind: "CLAIM" }),
            url: "https://hearth.example/claims/XyZ",
            emailSent: false,
          },
          201,
        ),
    });
    view({ api });
    const invite = screen.getByRole("region", { name: "Invita a Mamá a Hearth: verá lo de ustedes dos" });
    await userEvent.click(within(invite).getByRole("button", { name: "Invitar" }));
    expect(await within(invite).findByLabelText("Enlace para reclamar")).toHaveValue(
      "https://hearth.example/claims/XyZ",
    );
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-mama/guests/m-mama/claim-links");
    expect(within(invite).queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
  });

  it("shows twenty movements, then twenty more with Cargar más", async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      entry(`t-${i}`, `2026-10-${String(i + 1).padStart(2, "0")}`, `Gasto ${i + 1}`, 1_000),
    );
    view({ history: { ...HISTORY, entries: many } });
    expect(rows()).toHaveLength(20);
    expect(rows()[0]).toMatch(/^Gasto 25/);
    await userEvent.click(screen.getByRole("button", { name: "Cargar más" }));
    expect(rows()).toHaveLength(25);
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("speaks English", () => {
    view({}, "en");
    expect(screen.getByText("Not on Hearth")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Mamá owes you" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Record with Mamá" })).toBeInTheDocument();
  });
});

describe('removing a person from Amigos (ruling P339, board "Amigos · solicitudes y eliminar")', () => {
  const EVEN = {
    friend: friendDto({ net: cop(0) }),
    balances: [
      { memberId: "m-ana-mama", net: cop(0) },
      { memberId: "m-mama", net: cop(0) },
    ],
    suggestions: [],
  };

  it("removes someone the viewer is even with and goes back to Amigos", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/me/friends/{spaceId}": () => new Response(null, { status: 204 }),
    });
    view({ ...EVEN, api });
    await userEvent.click(screen.getByRole("button", { name: "Eliminar de Amigos" }));
    const sheet = await screen.findByRole("dialog", { name: "Eliminar a Mamá" });
    expect(
      within(sheet).getByText(
        "Están al día. Mamá deja de estar en tus amigos y lo que registraron juntos queda en tu historial.",
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("Con saldo pendiente, primero se salda.")).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Eliminar de Amigos" }));
    await vi.waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/balances"));
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`)).toEqual([
      "DELETE /api/v1/me/friends/sp-mama",
    ]);
  });

  it("says to settle first when the API finds a balance, with Saldar at hand", async () => {
    const { api } = fakeApi({
      "DELETE /api/v1/me/friends/{spaceId}": () =>
        problemResponse(409, "FriendHasBalance", { outstanding: cop(1_000) }),
    });
    view({ ...EVEN, api });
    await userEvent.click(screen.getByRole("button", { name: "Eliminar de Amigos" }));
    const sheet = await screen.findByRole("dialog", { name: "Eliminar a Mamá" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Eliminar de Amigos" }));
    expect(await within(sheet).findByRole("status")).toHaveTextContent(
      "Con saldo pendiente, primero se salda.",
    );
    expect(within(sheet).queryByRole("button", { name: "Eliminar de Amigos" })).not.toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Saldar" }));
    expect(await screen.findByRole("dialog", { name: "Saldar" })).toBeInTheDocument();
  });

  it("offers only Saldar while the screen already shows a balance", async () => {
    const { api, requests } = fakeApi({});
    view({ api });
    await userEvent.click(screen.getByRole("button", { name: "Eliminar de Amigos" }));
    const sheet = await screen.findByRole("dialog", { name: "Eliminar a Mamá" });
    expect(within(sheet).getByRole("status")).toHaveTextContent("Con saldo pendiente, primero se salda.");
    expect(within(sheet).queryByRole("button", { name: "Eliminar de Amigos" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Saldar" })).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it("names a payment between the two by the balance before it: paid, lent, or both (P339)", () => {
    const pay = (id: string, date: string, pesos: number, balance: number, fromAna: boolean) =>
      entry(id, date, "", pesos, {
        type: "SETTLEMENT",
        settlementReason: "PAYMENT",
        payerMemberId: fromAna ? "m-ana-mama" : "m-mama",
        receivingMemberId: fromAna ? "m-mama" : "m-ana-mama",
        balance: cop(balance),
      });
    view({
      history: {
        ...HISTORY,
        closing: cop(0),
        entries: [
          // Even, Ana gives Mamá 500.000: a loan.
          pay("t-1", "2026-10-01", 500_000, 500_000, true),
          // Mamá owes 500.000 and gives back 200.000: a payment.
          pay("t-2", "2026-10-02", -200_000, 300_000, false),
          // Mamá owes 300.000 and gives 500.000: she pays 300.000 and lends 200.000.
          pay("t-3", "2026-10-03", -500_000, -200_000, false),
          // Ana owes 200.000 and gives 200.000: a payment.
          pay("t-4", "2026-10-04", 200_000, 0, true),
        ],
      },
    });
    expect(rows().map((row) => row.replace(/^Pago\d+ oct · /, "").replace(/[−+]\$ [\d.]+$/, ""))).toEqual([
      "le pagaste",
      "Mamá te pagó $ 300.000 y te prestó $ 200.000",
      "Mamá te pagó",
      "le prestaste",
    ]);
  });
});

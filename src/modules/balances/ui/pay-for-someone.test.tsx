import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { BalancesScreen } from "./balances-screen";

// Ruling P322, boards B1-B8 (Penpot "E9-07 · Saldos", second row): in Friends, Benekin owes Camilou $ 4.500 and Camilox
// owes Camilou $ 500; Kamilox, who owes nobody, opens Saldos.
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-12T17:00:00Z"));
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

const KAMILOX = memberDto({ id: "m-kami", userId: "u-kami", displayName: "Kamilox", role: "MEMBER" });
const CAMILOX = memberDto({ id: "m-camilox", userId: "u-camilox", displayName: "Camilox", role: "MEMBER" });
const BENEKIN = guestDto({ id: "m-benekin", displayName: "Benekin" });
const CAMILOU = guestDto({ id: "m-camilou", displayName: "Camilou" });
const MEMBERS = [KAMILOX, CAMILOX, BENEKIN, CAMILOU];
const FRIENDS = householdSpace({ id: "sp-friends", name: "Friends", role: "MEMBER" });
const BALANCES = [
  { memberId: "m-kami", net: cop(0) },
  { memberId: "m-camilox", net: cop(-500) },
  { memberId: "m-benekin", net: cop(-4_500) },
  { memberId: "m-camilou", net: cop(5_000) },
];
const SUGGESTIONS = [
  { payerMemberId: "m-benekin", receivingMemberId: "m-camilou", amount: cop(4_500) },
  { payerMemberId: "m-camilox", receivingMemberId: "m-camilou", amount: cop(500) },
];
const NU = accountDto({ id: "a-nu", name: "Nu", ownerUserId: "u-kami" });
const CAMILOX_BANK = accountDto({ id: "a-camilox", name: "Bancolombia", ownerUserId: "u-camilox" });
const settled = () => jsonResponse(transactionDto({ id: "t-s", type: "SETTLEMENT" }), 201);
const TODAY = {
  date: "2026-11-12",
  occurredAt: "2026-11-12T17:00:00.000Z",
  timeZone: "America/Bogota",
};

const friendsAs = (
  meUserId: string,
  api: Api,
  props: Partial<Parameters<typeof BalancesScreen>[0]> = {},
  locale: "es" | "en" = "es",
) =>
  renderWithIntl(
    <BalancesScreen
      space={FRIENDS}
      members={MEMBERS}
      meUserId={meUserId}
      balances={BALANCES}
      suggestions={SUGGESTIONS}
      myAccounts={meUserId === "u-camilox" ? [CAMILOX_BANK] : [NU]}
      formats={BUILT_IN_FORMATS}
      timeZone="America/Bogota"
      api={api}
      {...props}
    />,
    { locale },
  );
const managing = (role: SpaceDto["role"]) => ({ space: { ...FRIENDS, role } });

// The sheet loads in a chunk of its own (#296): resolved once, so every test opens it as the screen does.
beforeAll(async () => {
  const { unmount } = friendsAs("u-kami", fakeApi({}).api);
  await userEvent.click(screen.getByRole("button", { name: "Saldar otro monto" }));
  await screen.findByRole("dialog", { name: "Saldar" });
  unmount();
});

/** An accessible name whose spaces match the formatters' non-breaking ones. */
const named = (text: string) => new RegExp(`^${text.replace(/[.()$¿?]/g, "\\$&").replace(/ /g, "\\s")}$`);
const BENEKIN_PAYS = named("Saldar: Benekin le paga $ 4.500 a Camilou");
const CAMILOX_PAYS = named("Saldar: Camilox le paga $ 500 a Camilou");
const dialog = () => screen.getByRole("dialog", { name: "Saldar" });
const group = (name: string) => within(dialog()).getByRole("radiogroup", { name });
const radioNames = (radios: HTMLElement) =>
  within(radios)
    .getAllByRole("radio")
    .map((radio) => normalized(radio.textContent));
const text = () => normalized(dialog().textContent);

describe("Saldar from a suggestion between two others (P322, boards B1-B3)", () => {
  it("B1: offers Benekin and Lo pago yo, records what Benekin paid outside the app with today's body", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    expect(within(dialog()).getByText("Friends · prellenado desde la sugerencia")).toBeInTheDocument();
    expect(radioNames(group("Quién paga"))).toEqual(["Benekin (invitado)", "Lo pago yo"]);
    expect(within(group("Quién paga")).getByRole("radio", { name: "Benekin (invitado)" })).toBeChecked();
    expect(normalized(within(dialog()).getByTestId("settle-receiver").textContent)).toBe(
      "Recibe Camilou (invitado)",
    );
    expect(within(dialog()).getByLabelText("Monto")).toHaveValue("4.500");
    expect(text()).toContain(
      "Anotas que Benekin le pagó $ 4.500 a Camilou por fuera de la app. No sale de tus cuentas.",
    );
    // Both are guests: no account on either side, and nothing asks whether Benekin pays the viewer back.
    expect(within(dialog()).queryByRole("radiogroup", { name: /Sale de/ })).toBeNull();
    expect(within(dialog()).queryByRole("radiogroup", { name: /Llega a/ })).toBeNull();
    expect(within(dialog()).queryByRole("radiogroup", { name: "¿Benekin te lo devuelve?" })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "450000", currency: "COP" },
      payerMemberId: "m-benekin",
      receivingMemberId: "m-camilou",
    });
  });

  it("B2: Lo pago yo asks whether Benekin pays it back, Me lo debe by default, and pays from the viewer's account", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Lo pago yo" }));
    const back = group("¿Benekin te lo devuelve?");
    expect(radioNames(back)).toEqual(["Me lo debe", "Se lo regalo"]);
    expect(within(back).getByRole("radio", { name: "Me lo debe" })).toBeChecked();
    expect(within(group("Sale de (opcional)")).getByRole("radio", { name: "Nu" })).toBeChecked();
    expect(text()).toContain(
      "Le pagas $ 4.500 a Camilou por Benekin. Camilou queda al día y Benekin pasa a deberte $ 4.500.",
    );
    expect(text()).not.toContain("Anotas que");
    expect(within(dialog()).queryByRole("button", { name: "Guardar pago" })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Pagar por Benekin" }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "450000", currency: "COP" },
      payerMemberId: "m-kami",
      receivingMemberId: "m-camilou",
      onBehalfOfMemberId: "m-benekin",
      gift: false,
      sourceAccountId: "a-nu",
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("B3: Se lo regalo says nobody owes the viewer and sends gift true", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Lo pago yo" }));
    await userEvent.click(
      within(group("¿Benekin te lo devuelve?")).getByRole("radio", { name: "Se lo regalo" }),
    );
    expect(text()).toContain(
      "Le pagas $ 4.500 a Camilou por Benekin y se los regalas. Camilou y Benekin quedan al día; nadie te debe.",
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Pagar y regalar" }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "450000", currency: "COP" },
      payerMemberId: "m-kami",
      receivingMemberId: "m-camilou",
      onBehalfOfMemberId: "m-benekin",
      gift: true,
      sourceAccountId: "a-nu",
    });
  });

  it("pays part of Benekin's debt without saying anyone ends al día (S3.5)", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Lo pago yo" }));
    await userEvent.clear(within(dialog()).getByLabelText("Monto"));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "2.000");
    expect(text()).toContain("Le pagas $ 2.000 a Camilou por Benekin y Benekin pasa a deberte $ 2.000.");
    expect(text()).not.toContain("queda al día");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Pagar por Benekin" }));
    expect(await requests[0]!.json()).toMatchObject({ amount: { amount: "200000" }, gift: false });
  });

  it("goes back to today's record and body when Benekin is chosen again", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Lo pago yo" }));
    await userEvent.click(
      within(group("¿Benekin te lo devuelve?")).getByRole("radio", { name: "Se lo regalo" }),
    );
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Benekin (invitado)" }));
    expect(within(dialog()).queryByRole("radiogroup", { name: "¿Benekin te lo devuelve?" })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "450000", currency: "COP" },
      payerMemberId: "m-benekin",
      receivingMemberId: "m-camilou",
    });
  });

  it("does not offer Lo pago yo to the suggestion's payer", async () => {
    friendsAs("u-camilox", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: CAMILOX_PAYS }));
    expect(within(group("Quién paga")).queryByRole("radio", { name: "Lo pago yo" })).toBeNull();
    expect(within(group("Quién paga")).getByRole("radio", { name: "Camilox (tú)" })).toBeChecked();
  });

  it("does not offer Lo pago yo to the suggestion's receiver", async () => {
    const LEDA = memberDto({ id: "m-leda", userId: "u-leda", displayName: "Leda", role: "MEMBER" });
    friendsAs("u-leda", fakeApi({}).api, {
      members: [...MEMBERS, LEDA],
      suggestions: [{ payerMemberId: "m-benekin", receivingMemberId: "m-leda", amount: cop(4_500) }],
    });
    await userEvent.click(
      screen.getByRole("button", { name: named("Saldar: Benekin le paga $ 4.500 a Leda") }),
    );
    expect(within(group("Quién paga")).queryByRole("radio", { name: "Lo pago yo" })).toBeNull();
  });

  it("shows InvalidOnBehalfOf by who pays and GiftRequiresOnBehalfOf by the gift choice", async () => {
    let code = "InvalidOnBehalfOf";
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": () => problemResponse(422, code),
    });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Lo pago yo" }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Pagar por Benekin" }));
    await waitFor(() =>
      expect(group("Quién paga")).toHaveAccessibleDescription(
        "Solo puedes pagar por otro miembro de este espacio, que no sea quien paga ni quien recibe.",
      ),
    );
    code = "GiftRequiresOnBehalfOf";
    await userEvent.click(
      within(group("¿Benekin te lo devuelve?")).getByRole("radio", { name: "Se lo regalo" }),
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Pagar y regalar" }));
    await waitFor(() =>
      expect(group("¿Benekin te lo devuelve?")).toHaveAccessibleDescription(
        "Solo se regala lo que pagas por otro miembro.",
      ),
    );
    expect(group("Quién paga")).not.toHaveAccessibleDescription(/./);
  });

  it("reads B2 in English with no accessibility violations", async () => {
    friendsAs("u-kami", fakeApi({}).api, {}, "en");
    await userEvent.click(
      screen.getByRole("button", { name: named("Settle: Benekin pays Camilou $ 4.500") }),
    );
    const sheet = screen.getByRole("dialog", { name: "Settle" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "I'll pay" }));
    const back = within(sheet).getByRole("radiogroup", { name: "Does Benekin pay you back?" });
    expect(radioNames(back)).toEqual(["Benekin owes me", "It's a gift"]);
    expect(normalized(sheet.textContent)).toContain(
      "You pay Camilou $ 4.500 for Benekin. Camilou is settled up and Benekin now owes you $ 4.500.",
    );
    expect(within(sheet).getByRole("button", { name: "Pay for Benekin" })).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);
  });
});

describe("Saldar otro monto: both payer and receiver are chosen (P322, board B4)", () => {
  it("offers every member as payer, Tú first, and everyone but the payer as receiver", async () => {
    friendsAs("u-kami", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: "Saldar otro monto" }));
    expect(within(dialog()).getByText("Friends")).toBeInTheDocument();
    expect(radioNames(group("Quién paga"))).toEqual([
      "Tú",
      "Camilox",
      "Benekin (invitado)",
      "Camilou (invitado)",
    ]);
    expect(within(dialog()).queryByTestId("settle-receiver")).toBeNull();
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Camilox" }));
    expect(radioNames(group("A quién"))).toEqual(["Tú", "Benekin (invitado)", "Camilou (invitado)"]);
  });

  it("records Camilox paying Camilou $ 500 with no account, and says both end al día", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: "Saldar otro monto" }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Camilox" }));
    await userEvent.click(within(group("A quién")).getByRole("radio", { name: "Camilou (invitado)" }));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "500");
    expect(text()).toContain(
      "Anotas que Camilox le pagó $ 500 a Camilou: los dos quedan al día. Quien paga y quien recibe se eligen; nadie queda fijo.",
    );
    expect(within(dialog()).queryByRole("radiogroup", { name: /Sale de/ })).toBeNull();
    expect(within(dialog()).queryByRole("radiogroup", { name: /Llega a/ })).toBeNull();
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "50000", currency: "COP" },
      payerMemberId: "m-camilox",
      receivingMemberId: "m-camilou",
    });
  });

  it("asks who receives before sending anything", async () => {
    const { api, requests } = fakeApi({});
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: "Saldar otro monto" }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Tú" }));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "1.000");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(group("A quién")).toHaveAccessibleDescription("Elige a quién le paga.");
    expect(requests).toHaveLength(0);
  });

  it("keeps the account choosers on the viewer's own side: Sale de when Tú pays, Llega a when Tú receives", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api);
    await userEvent.click(screen.getByRole("button", { name: "Saldar otro monto" }));
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Camilox" }));
    await userEvent.click(within(group("A quién")).getByRole("radio", { name: "Tú" }));
    expect(within(group("Llega a (opcional)")).getByRole("radio", { name: "Nu" })).toBeChecked();
    await userEvent.click(within(group("Quién paga")).getByRole("radio", { name: "Tú" }));
    // The receiver was the new payer: it is chosen again, never kept as the payer's own.
    expect(within(group("A quién")).queryByRole("radio", { checked: true })).toBeNull();
    expect(within(group("Sale de (opcional)")).getByRole("radio", { name: "Nu" })).toBeChecked();
    expect(within(dialog()).queryByRole("radiogroup", { name: /Llega a/ })).toBeNull();
    await userEvent.click(within(group("A quién")).getByRole("radio", { name: "Benekin (invitado)" }));
    await userEvent.type(within(dialog()).getByLabelText("Monto"), "1.000");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Guardar pago" }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "100000", currency: "COP" },
      payerMemberId: "m-kami",
      receivingMemberId: "m-benekin",
      sourceAccountId: "a-nu",
    });
  });
});

describe("Perdonar en vez de cobrar (P322, board B8)", () => {
  const forgiving = () => screen.getByRole("dialog", { name: "¿Perdonar la deuda de Benekin?" });

  it("lets an admin forgive for the guest Camilou, with no account, as FORGIVENESS", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-kami", api, managing("ADMIN"));
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Perdonar en vez de cobrar" }));
    const sheet = forgiving();
    expect(within(sheet).getByText(named("Friends · Benekin le debe $ 4.500 a Camilou"))).toBeInTheDocument();
    expect(normalized(within(sheet).getByTestId("forgive-receiver").textContent)).toBe(
      "Quien cobra Camilou (invitado)",
    );
    expect(within(sheet).getByLabelText("Monto")).toHaveValue("4.500");
    expect(normalized(sheet.textContent)).toContain(
      "Benekin queda al día y Camilou deja de recibir $ 4.500. No se mueve dinero. Perdona solo quien cobra; como Camilou es invitado, lo hace quien administra Friends.",
    );
    expect(within(sheet).queryByRole("radiogroup")).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: named("Perdonar $ 4.500") }));
    expect(await requests[0]!.json()).toEqual({
      ...TODAY,
      amount: { amount: "450000", currency: "COP" },
      payerMemberId: "m-benekin",
      receivingMemberId: "m-camilou",
      reason: "FORGIVENESS",
    });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("lets the owner forgive for a guest receiver too", async () => {
    friendsAs("u-kami", fakeApi({}).api, managing("OWNER"));
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    expect(within(dialog()).getByRole("button", { name: "Perdonar en vez de cobrar" })).toBeInTheDocument();
  });

  it("does not offer forgiving to a member who is not the receiver nor a manager", async () => {
    friendsAs("u-kami", fakeApi({}).api, managing("MEMBER"));
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    expect(within(dialog()).queryByRole("button", { name: "Perdonar en vez de cobrar" })).toBeNull();
  });

  it("does not offer forgiving from Saldar otro monto", async () => {
    friendsAs("u-kami", fakeApi({}).api, managing("ADMIN"));
    await userEvent.click(screen.getByRole("button", { name: "Saldar otro monto" }));
    expect(within(dialog()).queryByRole("button", { name: "Perdonar en vez de cobrar" })).toBeNull();
  });

  it("lets the receiver forgive their own debtor, and says so in their words", async () => {
    const LEDA = memberDto({ id: "m-leda", userId: "u-leda", displayName: "Leda", role: "MEMBER" });
    const { api, requests } = fakeApi({ "POST /api/v1/spaces/{spaceId}/settlements": settled });
    friendsAs("u-leda", api, {
      members: [...MEMBERS, LEDA],
      myAccounts: [accountDto({ id: "a-leda", name: "Daviplata", ownerUserId: "u-leda" })],
      suggestions: [{ payerMemberId: "m-benekin", receivingMemberId: "m-leda", amount: cop(4_500) }],
    });
    await userEvent.click(
      screen.getByRole("button", { name: named("Saldar: Benekin le paga $ 4.500 a Leda") }),
    );
    await userEvent.click(within(dialog()).getByRole("button", { name: "Perdonar en vez de cobrar" }));
    const sheet = forgiving();
    expect(normalized(within(sheet).getByTestId("forgive-receiver").textContent)).toBe(
      "Quien cobra Leda (tú)",
    );
    expect(normalized(sheet.textContent)).toContain(
      "Benekin queda al día y dejas de recibir $ 4.500. No se mueve dinero. Perdona solo quien cobra.",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: named("Perdonar $ 4.500") }));
    const body = await requests[0]!.json();
    expect(body).toEqual({
      ...TODAY,
      amount: { amount: "450000", currency: "COP" },
      payerMemberId: "m-benekin",
      receivingMemberId: "m-leda",
      reason: "FORGIVENESS",
    });
  });

  it("shows ForgivenessNotAllowed on the sheet and keeps it open", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/settlements": () => problemResponse(403, "ForgivenessNotAllowed"),
    });
    friendsAs("u-kami", api, managing("ADMIN"));
    await userEvent.click(screen.getByRole("button", { name: BENEKIN_PAYS }));
    await userEvent.click(within(dialog()).getByRole("button", { name: "Perdonar en vez de cobrar" }));
    await userEvent.click(within(forgiving()).getByRole("button", { name: named("Perdonar $ 4.500") }));
    expect(await within(forgiving()).findByRole("alert")).toHaveTextContent(
      "Solo quien cobra puede perdonar la deuda; si es invitado, quien administra el espacio.",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("reads in English", async () => {
    friendsAs("u-kami", fakeApi({}).api, managing("ADMIN"), "en");
    await userEvent.click(
      screen.getByRole("button", { name: named("Settle: Benekin pays Camilou $ 4.500") }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Forgive instead of collecting" }));
    const sheet = screen.getByRole("dialog", { name: "Forgive Benekin's debt?" });
    expect(within(sheet).getByRole("button", { name: named("Forgive $ 4.500") })).toBeInTheDocument();
    expect(await axeViolations(sheet)).toEqual([]);
  });
});

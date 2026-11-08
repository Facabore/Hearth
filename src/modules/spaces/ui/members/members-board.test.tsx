import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { en, es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  cop,
  guestDto,
  householdSpace,
  invitationDto,
  memberDto,
  normalized,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { InvitationDto, MemberDto, MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import type { ToastInput } from "@/shared/ui/molecules/toast";
import { MembersScreen } from "./members-screen";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() },
  shown: [] as ToastInput[],
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/shared/ui/molecules/toast", () => ({
  useToast: () => ({ show: (toast: ToastInput) => mocks.shown.push(toast), dismiss: vi.fn() }),
}));
const { router, shown } = mocks;
beforeEach(() => {
  vi.clearAllMocks();
  shown.length = 0;
});
afterEach(() => vi.useRealTimers());

// The boards' Hogar: OWNER Ana (who created it), ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
const MEMBERS = [
  memberDto(),
  memberDto({
    id: "m-juan",
    userId: "u-juan",
    displayName: "Juan",
    role: "ADMIN",
    joinedAt: "2026-10-03T15:00:00.000Z",
  }),
  memberDto({
    id: "m-luis",
    userId: "u-luis",
    displayName: "Luis",
    role: "MEMBER",
    joinedAt: "2026-10-05T15:00:00.000Z",
  }),
  memberDto({
    id: "m-sofi",
    userId: "u-sofi",
    displayName: "Sofi",
    role: "VIEWER",
    joinedAt: "2026-10-05T16:00:00.000Z",
  }),
  guestDto(),
];
const PENDING = [
  invitationDto({ id: "inv-1", kind: "LINK", role: "VIEWER", expiresAt: "2026-10-24T14:00:00.000Z" }),
];

const screenAs = (
  meUserId: string,
  role: SpaceDto["role"],
  {
    api = fakeApi({}).api,
    members = MEMBERS,
    invitations = null,
    balances = {},
  }: {
    api?: Api;
    members?: readonly MemberDto[];
    invitations?: readonly InvitationDto[] | null;
    balances?: Readonly<Record<string, MoneyDto>>;
  } = {},
) =>
  renderWithIntl(
    <MembersScreen
      space={householdSpace({ role })}
      members={members}
      meUserId={meUserId}
      invitations={invitations}
      balances={balances}
      formats={BUILT_IN_FORMATS}
      viewerZone="America/Bogota"
      api={api}
    />,
  );
const rowOf = (name: string) => screen.getByRole("listitem", { name });

describe("Miembros as its board (E9-05 · 01-03, ruling P272)", () => {
  it("puts Invitar and Agregar invitados side by side at equal width for an OWNER, with no rename section", () => {
    screenAs("u-ana", "OWNER");
    const invite = screen.getByRole("button", { name: "Invitar" });
    const add = screen.getByRole("button", { name: "Agregar invitados" });
    expect(invite.parentElement).toBe(add.parentElement);
    expect(invite.parentElement).toHaveClass("grid", "grid-cols-2");
    // The board has no "Espacio / Nombre del espacio" block: the space is renamed in Ajustes.
    expect(screen.queryByLabelText("Nombre del espacio")).not.toBeInTheDocument();
  });

  it("says the owner created the space, writes roles nobody may change as plain text, and gives the guest no role", () => {
    screenAs("u-ana", "OWNER");
    expect(within(rowOf("Ana (tú)")).getByText("Creó el espacio")).toBeInTheDocument();
    expect(within(rowOf("Ana (tú)")).queryByText(/Se unió/)).not.toBeInTheDocument();
    const owner = within(rowOf("Ana (tú)")).getByText("Propietario");
    expect(owner).not.toHaveAttribute("data-tone");
    expect(within(rowOf("Pedro (invitado)")).queryByText("Sin rol")).not.toBeInTheDocument();
    expect(within(rowOf("Juan")).getByText("Se unió el 3/10/2026")).toBeInTheDocument();
  });

  it("gives a MEMBER one full-width Agregar invitados and every role as plain text (board 02)", () => {
    screenAs("u-luis", "MEMBER");
    expect(screen.getByRole("button", { name: "Agregar invitados" })).toHaveClass("w-full");
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
    for (const [name, role] of [
      ["Ana", "Propietario"],
      ["Juan", "Administrador"],
      ["Luis (tú)", "Miembro"],
      ["Sofi", "Lector"],
    ] as const)
      expect(within(rowOf(name)).getByText(role)).not.toHaveAttribute("data-tone");
    expect(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" })).toBeInTheDocument();
  });

  it("tells a VIEWER what the role allows, as the board words it, and offers no control (board 03)", () => {
    screenAs("u-sofi", "VIEWER");
    expect(
      screen.getByText(
        "Tu rol en Household es Lector: puedes ver miembros, saldos y tableros, pero no invitar ni agregar invitados.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Opciones de/ })).not.toBeInTheDocument();
  });

  it("keeps every control of the screen at least 44 px tall", () => {
    screenAs("u-ana", "OWNER", { invitations: PENDING });
    for (const name of ["Invitar", "Agregar invitados"])
      expect(screen.getByRole("button", { name })).toHaveClass("h-12");
    expect(screen.getByRole("button", { name: "Rol de Juan: Administrador. Cambiar" })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" })).toHaveClass("size-11");
    expect(screen.getByRole("button", { name: /^Revocar/ })).toHaveClass("h-12");
  });

  it("keeps its way back to the space's home (S1)", () => {
    screenAs("u-sofi", "VIEWER");
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
  });
});

describe("the role selector (Pantallas nuevas · 02; P164 overridden by P272)", () => {
  it("names the space and when Juan joined, lists three roles in one radio list, marks the current one and says who changes roles", async () => {
    screenAs("u-ana", "OWNER");
    await userEvent.click(screen.getByRole("button", { name: "Rol de Juan: Administrador. Cambiar" }));
    const sheet = screen.getByRole("dialog", { name: "Rol de Juan en Household" });
    expect(sheet).toHaveAccessibleDescription("Se unió el 3/10/2026");
    const radios = within(sheet).getAllByRole("radio");
    expect(radios.map((radio) => radio.getAttribute("value"))).toEqual(["ADMIN", "MEMBER", "VIEWER"]);
    expect(within(sheet).queryByRole("radio", { name: /Propietario/ })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("radio", { name: /Administrador/ })).toBeChecked();
    const current = within(sheet).getByText("Actual");
    expect(current.closest("label")).toHaveTextContent("Administrador");
    expect(
      within(sheet).getByText("Solo el Propietario cambia roles. Propietario no se asigna aquí."),
    ).toBeVisible();
    for (const radio of radios) expect(radio.closest("label")).toHaveClass("min-h-14");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("saves the role chosen from the list", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/members/{memberId}": () =>
        jsonResponse({ ...MEMBERS[1], role: "VIEWER" }),
    });
    screenAs("u-ana", "OWNER", { api });
    await userEvent.click(screen.getByRole("button", { name: "Rol de Juan: Administrador. Cambiar" }));
    const sheet = screen.getByRole("dialog", { name: "Rol de Juan en Household" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /Lector/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar rol" }));
    expect(await requests[0]!.json()).toEqual({ role: "VIEWER" });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("offers no role change for another owner: Propietario is not assigned there", () => {
    screenAs("u-bea", "OWNER", {
      members: [memberDto(), memberDto({ id: "m-bea", userId: "u-bea", displayName: "Bea", role: "OWNER" })],
    });
    expect(screen.queryByRole("button", { name: /^Rol de/ })).not.toBeInTheDocument();
    expect(within(rowOf("Ana")).getByText("Propietario")).toBeInTheDocument();
  });
});

describe("the guest sheet (E9-05 · 06)", () => {
  it("says up front that Pedro, who has a balance, cannot be removed, and offers Saldar", async () => {
    const { api, requests } = fakeApi({});
    screenAs("u-ana", "OWNER", { api, balances: { "m-pedro": cop(-100_000) } });
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    const balance = within(sheet).getByText(/En Household/);
    // The direction is a word ("le toca poner"), never the colour alone.
    expect(normalized(balance.textContent)).toBe("En Household · le toca poner $ 100.000");
    expect(normalized(within(balance).getByText(/100\.000/).textContent)).toBe("$ 100.000");
    expect(within(balance).getByText(/100\.000/).tagName).toBe("STRONG");
    const blocked = within(sheet).getByRole("note");
    expect(normalized(blocked.textContent)).toContain(
      "No puedes quitar a Pedro: tiene un saldo pendiente de $ 100.000. Primero registren el pago.",
    );
    expect(within(blocked).getByRole("link", { name: "Saldar" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/balances?settle=m-pedro",
    );
    expect(within(blocked).getByRole("link", { name: "Saldar" })).toHaveClass("min-h-11");
    expect(within(sheet).getByRole("button", { name: "Quitar de Household" })).toBeDisabled();
    expect(requests).toHaveLength(0);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("confirms the removal of a settled guest in its own sheet, side by side, and removes him (Pantallas nuevas · 04)", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/guests/{memberId}": () => new Response(null, { status: 204 }),
    });
    screenAs("u-ana", "OWNER", { api });
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar de Household" }));
    const confirm = screen.getByRole("dialog", { name: "¿Quitar a Pedro (invitado) de Household?" });
    expect(normalized(within(confirm).getByText(/Su saldo está en/).textContent)).toBe(
      "Su saldo está en $ 0. Su historial queda en los movimientos con su nombre.",
    );
    const cancel = within(confirm).getByRole("button", { name: "Cancelar" });
    const remove = within(confirm).getByRole("button", { name: "Quitar de Household" });
    expect(cancel.parentElement).toBe(remove.parentElement);
    expect(cancel.parentElement).toHaveClass("grid-cols-2");
    expect(remove).toHaveClass("h-14");
    await userEvent.click(remove);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests[0]!.method).toBe("DELETE");
  });

  it("goes back to the guest from the confirmation's Cancelar, removing nobody", async () => {
    const { api, requests } = fakeApi({});
    screenAs("u-ana", "OWNER", { api });
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    await userEvent.click(screen.getByRole("button", { name: "Quitar de Household" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog", { name: "Pedro (invitado)" })).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
});

describe("the add-guests sheet (E9-05 · 05, P309)", () => {
  it("words the intro as the board, hints the email inside the field, and words the claim note for one guest or several", async () => {
    screenAs("u-ana", "OWNER");
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitados" }));
    const sheet = await screen.findByRole("dialog", { name: "Agregar invitados a Household" });
    expect(sheet).toHaveAccessibleDescription(
      "Para alguien que no usa Hearth. Puede pagar, poner su parte, aportar al plan y recibir pagos, solo en Household. No inicia sesión.",
    );
    expect(within(sheet).getByLabelText("Correo (opcional)")).toHaveAttribute(
      "placeholder",
      "Para recordarlo; no recibe nada",
    );
    expect(within(sheet).getByRole("note")).toHaveTextContent(
      "Si alguno se registra después, le envías un enlace para reclamar su lugar y se lleva todo su historial.",
    );
  });
});

describe("the invite sheet (E9-05 · 04)", () => {
  it("shows Rol al unirse over full-width role cards, the chosen one checked", async () => {
    screenAs("u-ana", "OWNER", { invitations: [] });
    await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
    const sheet = screen.getByRole("dialog", { name: "Invitar a Household" });
    const heading = within(sheet).getByText("Rol al unirse");
    const group = within(sheet).getByRole("radiogroup", { name: "Rol al unirse" });
    expect(group).toHaveAttribute("aria-labelledby", heading.id);
    expect(group).toHaveClass("flex-col");
    const member = within(group).getByRole("radio", { name: "Miembro" });
    expect(member).toBeChecked();
    expect(member).toHaveAccessibleDescription("Registra gastos y pagos, agrega invitados");
    expect(member.querySelector("svg")).not.toBeNull();
    expect(within(group).getByRole("radio", { name: "Lector" }).querySelector("svg")).toBeNull();
  });
});

describe("revoking an invitation with undo (Pantallas nuevas · 03, ruling P274)", () => {
  const REVOKE = "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke";
  const RESTORE = "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/restore";
  const revokeButton = () =>
    screen.getByRole("button", { name: "Revocar el enlace de invitación como Lector" });
  const paths = (requests: Request[]) => requests.map((request) => new URL(request.url).pathname);

  it("hides the invitation, revokes it at once and offers Deshacer", async () => {
    const { api, requests } = fakeApi({ [REVOKE]: () => jsonResponse({ ...PENDING[0], status: "REVOKED" }) });
    screenAs("u-ana", "OWNER", { api, invitations: PENDING });
    await userEvent.click(revokeButton());
    expect(screen.queryByRole("region", { name: "Invitaciones pendientes" })).not.toBeInTheDocument();
    expect(shown).toHaveLength(1);
    expect(shown[0]!.message).toBe("Invitación revocada");
    expect(shown[0]!.action?.label).toBe("Deshacer");
    // No timer stands between the revoke and the API: the link stops working as the toast appears.
    await waitFor(() =>
      expect(paths(requests)).toEqual(["/api/v1/spaces/sp-household/invitations/inv-1/revoke"]),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("restores the invitation on the server with Deshacer and shows it again", async () => {
    const { api, requests } = fakeApi({
      [REVOKE]: () => jsonResponse({ ...PENDING[0], status: "REVOKED" }),
      [RESTORE]: () => jsonResponse(PENDING[0]),
    });
    screenAs("u-ana", "OWNER", { api, invitations: PENDING });
    await userEvent.click(revokeButton());
    await act(async () => shown[0]!.action!.onAction());
    await waitFor(() =>
      expect(paths(requests)).toEqual([
        "/api/v1/spaces/sp-household/invitations/inv-1/revoke",
        "/api/v1/spaces/sp-household/invitations/inv-1/restore",
      ]),
    );
    expect(
      await screen.findByRole("button", { name: "Revocar el enlace de invitación como Lector" }),
    ).toBeVisible();
  });

  it("sends the restore only after the revoke it undoes has answered", async () => {
    let answer: (response: Response) => void = () => undefined;
    const { api, requests } = fakeApi({
      [REVOKE]: () => new Promise<Response>((resolve) => (answer = resolve)),
      [RESTORE]: () => jsonResponse(PENDING[0]),
    });
    screenAs("u-ana", "OWNER", { api, invitations: PENDING });
    await userEvent.click(revokeButton());
    act(() => shown[0]!.action!.onAction());
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(paths(requests)).toEqual(["/api/v1/spaces/sp-household/invitations/inv-1/revoke"]);
    await act(async () => answer(jsonResponse({ ...PENDING[0], status: "REVOKED" })));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(paths(requests)[1]).toBe("/api/v1/spaces/sp-household/invitations/inv-1/restore");
  });

  it("says the invitation stays revoked when the API no longer restores it", async () => {
    const { api } = fakeApi({
      [REVOKE]: () => jsonResponse({ ...PENDING[0], status: "REVOKED" }),
      [RESTORE]: () => problemResponse(409, "InvitationNotRestorable"),
    });
    screenAs("u-ana", "OWNER", { api, invitations: PENDING });
    await userEvent.click(revokeButton());
    await act(async () => shown[0]!.action!.onAction());
    await waitFor(() => expect(shown).toHaveLength(2));
    expect(shown[1]).toMatchObject({ tone: "alert", message: es.errors.InvitationNotRestorable });
    expect(screen.queryByRole("region", { name: "Invitaciones pendientes" })).not.toBeInTheDocument();
  });

  it("shows the invitation again with the problem when the revoke is refused", async () => {
    const { api } = fakeApi({ [REVOKE]: () => problemResponse(404, "InvitationNotFound") });
    screenAs("u-ana", "OWNER", { api, invitations: PENDING });
    await userEvent.click(revokeButton());
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(revokeButton()).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("the members copy speaks tú in Spanish and plain English", () => {
  it("never uses voseo in the strings these boards added", () => {
    expect(es.members.readOnlyNote).toContain("puedes ver miembros, saldos y tableros");
    expect(es.members.guest.blocked).toBe(
      "No puedes quitar a {name}: tiene un saldo pendiente de {amount}. Primero registren el pago.",
    );
    expect(es.members.roleSheet.lock).toBe(
      "Solo el Propietario cambia roles. Propietario no se asigna aquí.",
    );
    for (const text of [
      es.members.readOnlyNote,
      es.members.guest.blocked,
      ...Object.values(es.members.guestsSheet),
      es.ledger.split.addGuestsHint,
    ])
      expect(text).not.toMatch(/\b(podés|tenés|querés|registrá|pegá|sos)\b/);
    expect(en.members.roleSheet.lock).toBe("Only the Owner changes roles. Owner is not assigned here.");
    expect(en.members.guest.blocked).toBe(
      "You can't remove {name}: they have an outstanding balance of {amount}. Record the payment first.",
    );
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
import type { MoneyDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { MembersScreen } from "./members-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

// HU-E1-05's Household: OWNER Ana, ADMIN Juan, MEMBER Luis, VIEWER Sofi and the guest Pedro.
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
const screenAs = (
  meUserId: string,
  role: SpaceDto["role"],
  api: Api,
  balances: Readonly<Record<string, MoneyDto>> = {},
) =>
  renderWithIntl(
    <MembersScreen
      space={householdSpace({ role })}
      members={MEMBERS}
      meUserId={meUserId}
      invitations={null}
      balances={balances}
      formats={BUILT_IN_FORMATS}
      viewerZone="America/Bogota"
      api={api}
    />,
  );
const claimed = () =>
  jsonResponse(
    {
      invitation: invitationDto({ kind: "CLAIM" }),
      url: "https://hearth.example/claims/XyZ",
      emailSent: false,
    },
    201,
  );

describe("guests (HU-E9-05, ruling P163)", () => {
  it("shows Luis, a MEMBER, Add guest but not Invite, and Sofi, a VIEWER, neither", () => {
    const { unmount } = screenAs("u-luis", "MEMBER", fakeApi({}).api);
    expect(screen.getByRole("button", { name: "Agregar invitado" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
    unmount();
    screenAs("u-sofi", "VIEWER", fakeApi({}).api);
    expect(screen.queryByRole("button", { name: "Agregar invitado" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Opciones de Pedro (invitado)" })).not.toBeInTheDocument();
  });

  it("adds the guest Pedro with an optional email", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests": () => jsonResponse(guestDto(), 201),
    });
    screenAs("u-luis", "MEMBER", api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    await userEvent.type(within(sheet).getByLabelText("Nombre"), " Pedro ");
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(await requests[0]!.json()).toEqual({ displayName: "Pedro" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("creates one guest when the button is pressed twice while the request is in flight", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests": async () => {
        await gate;
        return jsonResponse(guestDto(), 201);
      },
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    await userEvent.type(within(sheet).getByLabelText("Nombre"), "Pedro");
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    release();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
  });

  it("sends the email when one is given", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests": () => jsonResponse(guestDto(), 201),
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    await userEvent.type(within(sheet).getByLabelText("Nombre"), "Pedro");
    await userEvent.type(within(sheet).getByLabelText("Correo (opcional)"), "pedro@example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(await requests[0]!.json()).toEqual({
      displayName: "Pedro",
      contactEmail: "pedro@example.com",
    });
  });

  it("previews the name as it will show, live, as the artboard does (390 px review, S7)", async () => {
    screenAs("u-ana", "OWNER", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    const name = within(sheet).getByLabelText("Nombre");
    expect(name).toHaveAccessibleDescription(
      "Se verá con «(invitado)» al lado. No puede repetir el nombre de otro miembro.",
    );
    await userEvent.type(name, "Pedro");
    expect(name).toHaveAccessibleDescription(
      "Se verá como «Pedro (invitado)». No puede repetir el nombre de otro miembro.",
    );
    await userEvent.clear(name);
    await userEvent.type(name, "  Ana María ");
    expect(name).toHaveAccessibleDescription(
      "Se verá como «Ana María (invitado)». No puede repetir el nombre de otro miembro.",
    );
  });

  it("puts MemberNameTaken under the name", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests": () => problemResponse(409, "MemberNameTaken"),
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Agregar invitado" }));
    const sheet = screen.getByRole("dialog", { name: "Agregar invitado a Household" });
    await userEvent.type(within(sheet).getByLabelText("Nombre"), "Juan");
    await userEvent.type(within(sheet).getByLabelText("Correo (opcional)"), "juan@example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar invitado" }));
    await waitFor(() =>
      expect(within(sheet).getByLabelText("Nombre")).toHaveAccessibleDescription(
        "Se verá como «Juan (invitado)». No puede repetir el nombre de otro miembro. Ya hay un miembro con ese nombre en este espacio.",
      ),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("creates a claim link for Pedro, single use, expiring 7 days later", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links": claimed,
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(within(sheet).getByText("En Household · a paz y salvo")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear enlace para reclamar" }));
    expect(await within(sheet).findByLabelText("Enlace para reclamar")).toHaveValue(
      "https://hearth.example/claims/XyZ",
    );
    expect(within(sheet).getByText("Un solo uso · vence el 19/10/2026")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Crear enlace para reclamar" })).toBeDisabled();
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/guests/m-pedro/claim-links");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("shows the claim link's URL once: reopening the sheet never shows it again", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/guests/{memberId}/claim-links": claimed,
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear enlace para reclamar" }));
    expect(await screen.findByLabelText("Enlace para reclamar")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(within(sheet).queryByLabelText("Enlace para reclamar")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("https://hearth.example/claims/XyZ")).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Crear enlace para reclamar" })).toBeEnabled();
    expect(requests).toHaveLength(1);
  });

  it("refuses to remove Pedro while he owes 100,000 COP, showing the amount, and keeps him listed", async () => {
    const { api } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/guests/{memberId}": () =>
        problemResponse(409, "OutstandingBalance", {
          outstanding: { amount: "10000000", currency: "COP" },
        }),
    });
    screenAs("u-ana", "OWNER", api, { "m-pedro": cop(-100_000) });
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(normalized(within(sheet).getByText(/En Household/).textContent)).toBe(
      "En Household · le toca poner $ 100.000",
    );
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar de Household" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));
    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent(
      "Para salir del espacio, quitar a alguien o archivar el espacio, los saldos tienen que quedar en cero. Registra los pagos que falten para quedar al día y vuelve a intentarlo.",
    );
    expect(normalized(alert.textContent)).toContain("Saldo pendiente: $ 100.000");
    expect(within(alert).getByRole("link", { name: "Registrar pago" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/balances?settle=m-pedro",
    );
    expect(router.refresh).not.toHaveBeenCalled();
    // The open sheet hides the page from the accessibility tree, so the list is queried with `hidden`.
    expect(screen.getByRole("listitem", { name: "Pedro (invitado)", hidden: true })).toBeInTheDocument();
  });

  it("removes a settled guest after the confirmation", async () => {
    const { api, requests } = fakeApi({
      "DELETE /api/v1/spaces/{spaceId}/guests/{memberId}": () => new Response(null, { status: 204 }),
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar de Household" }));
    expect(
      within(sheet).getByText("¿Quitar a Pedro de Household? Su historial se conserva."),
    ).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Sí, quitar" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(requests[0]!.method).toBe("DELETE");
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/guests/m-pedro");
  });

  it("does not remove anyone when the confirmation is cancelled", async () => {
    const { api, requests } = fakeApi({});
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar de Household" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    expect(within(sheet).getByRole("button", { name: "Quitar de Household" })).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("gives a direct space's guest a claim link but no removal (D16)", async () => {
    renderWithIntl(
      <MembersScreen
        space={householdSpace({ role: "OWNER", kind: "DIRECT", name: "Ana & Pedro" })}
        members={[memberDto(), guestDto()]}
        meUserId="u-ana"
        formats={BUILT_IN_FORMATS}
        viewerZone="America/Bogota"
        api={fakeApi({}).api}
      />,
    );
    expect(screen.queryByRole("button", { name: "Agregar invitado" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(within(sheet).getByRole("button", { name: "Crear enlace para reclamar" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /^Quitar de/ })).not.toBeInTheDocument();
  });

  it("gives a MEMBER removal but not claim links", async () => {
    screenAs("u-luis", "MEMBER", fakeApi({}).api);
    await userEvent.click(screen.getByRole("button", { name: "Opciones de Pedro (invitado)" }));
    const sheet = screen.getByRole("dialog", { name: "Pedro (invitado)" });
    expect(
      within(sheet).queryByRole("button", { name: "Crear enlace para reclamar" }),
    ).not.toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Quitar de Household" })).toBeInTheDocument();
  });
});

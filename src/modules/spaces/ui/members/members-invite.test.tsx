import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  guestDto,
  householdSpace,
  invitationDto,
  memberDto,
  normalized,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { InvitationDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { MembersScreen } from "./members-screen";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const MEMBERS = [
  memberDto(),
  memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis", role: "MEMBER" }),
  guestDto(),
];
const PENDING = [
  invitationDto({
    id: "inv-2",
    kind: "EMAIL",
    email: "marta@example.com",
    role: "MEMBER",
    expiresAt: "2026-10-26T14:00:00.000Z",
  }),
  invitationDto({ id: "inv-1", kind: "LINK", role: "VIEWER", expiresAt: "2026-10-24T14:00:00.000Z" }),
];
const created = (
  body: Partial<{ kind: "LINK" | "EMAIL"; email: string | null; role: string }>,
  emailSent = false,
) =>
  jsonResponse(
    {
      invitation: invitationDto({ id: "inv-9", ...body } as never),
      url: "https://hearth.example/invitations/AbC",
      emailSent,
    },
    201,
  );
const screenAs = (
  meUserId: string,
  role: SpaceDto["role"],
  api: Api,
  invitations: InvitationDto[] | null = [],
  openInvite = false,
) =>
  renderWithIntl(
    <MembersScreen
      openInvite={openInvite}
      space={householdSpace({ role })}
      members={MEMBERS}
      meUserId={meUserId}
      invitations={invitations}
      formats={BUILT_IN_FORMATS}
      viewerZone="America/Bogota"
      api={api}
    />,
  );
const openInvite = async () => {
  await userEvent.click(screen.getByRole("button", { name: "Invitar" }));
  return screen.getByRole("dialog", { name: "Invitar a Household" });
};

describe("Invitar from the home opens the sheet (N10)", () => {
  it("opens the invite sheet at once for someone who may invite, and drops ?invite= when it closes", async () => {
    screenAs("u-ana", "OWNER", fakeApi({}).api, [], true);
    expect(screen.getByRole("dialog", { name: "Invitar a Household" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household/members");
  });

  it("opens nothing for someone who may not invite", () => {
    screenAs("u-luis", "MEMBER", fakeApi({}).api, null, true);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("leaves the address alone when the sheet was opened by its button", async () => {
    screenAs("u-ana", "OWNER", fakeApi({}).api);
    await openInvite();
    await userEvent.keyboard("{Escape}");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("inviting people (HU-E9-05, ruling P162)", () => {
  it("shows Invite to the OWNER and not to a MEMBER", () => {
    const { unmount } = screenAs("u-ana", "OWNER", fakeApi({}).api);
    expect(screen.getByRole("button", { name: "Invitar" })).toBeInTheDocument();
    unmount();
    screenAs("u-luis", "MEMBER", fakeApi({}).api, null);
    expect(screen.queryByRole("button", { name: "Invitar" })).not.toBeInTheDocument();
  });

  it("creates a link as VIEWER only when asked, and shows its URL once with Copy", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": () => created({ kind: "LINK", role: "VIEWER" }),
    });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    expect(requests).toHaveLength(0);
    expect(within(sheet).getByRole("radio", { name: /Miembro/ })).toBeChecked();
    expect(within(sheet).queryByRole("radio", { name: /Propietario/ })).not.toBeInTheDocument();
    expect(
      within(sheet).getByText("Nadie se une como Propietario: ese rol se cambia desde Miembros."),
    ).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Lector/ }));
    await userEvent.dblClick(within(sheet).getByRole("button", { name: "Crear enlace" }));
    expect(await within(sheet).findByLabelText("Enlace de invitación")).toHaveValue(
      "https://hearth.example/invitations/AbC",
    );
    expect(requests).toHaveLength(1);
    expect(await requests[0]!.json()).toEqual({ kind: "LINK", role: "VIEWER" });
    expect(
      within(sheet).getByText(/Rol Lector · vence el 19\/10\/2026\. Sirve para varias personas/),
    ).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("sends one request while the first one is still in flight", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": async () => {
        await gate;
        return created({ kind: "LINK", role: "MEMBER" });
      },
    });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    const button = within(sheet).getByRole("button", { name: "Crear enlace" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    release();
    expect(await within(sheet).findByLabelText("Enlace de invitación")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("forgets the URL when the role changes, and never shows it again after the sheet closes (P155)", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": () => created({ kind: "LINK", role: "MEMBER" }),
    });
    screenAs("u-ana", "OWNER", api, PENDING);
    let sheet = await openInvite();
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear enlace" }));
    expect(await within(sheet).findByLabelText("Enlace de invitación")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Administrador/ }));
    expect(within(sheet).queryByLabelText("Enlace de invitación")).not.toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear enlace" }));
    expect(await within(sheet).findByLabelText("Enlace de invitación")).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    sheet = await openInvite();
    expect(within(sheet).queryByLabelText("Enlace de invitación")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("https://hearth.example/invitations/AbC")).not.toBeInTheDocument();
  });

  it("puts InvalidEmail under the email, then shows the URL when Hearth could not send the email", async () => {
    let calls = 0;
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": () =>
        (calls += 1) === 1
          ? problemResponse(422, "InvalidEmail")
          : created({ kind: "EMAIL", email: "marta@example.com" }, false),
    });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Correo" }));
    await userEvent.type(within(sheet).getByLabelText("Correo de la persona"), "marta@");
    await userEvent.click(within(sheet).getByRole("button", { name: "Enviar invitación" }));
    await waitFor(() =>
      expect(within(sheet).getByLabelText("Correo de la persona")).toHaveAccessibleDescription(
        "Solo esa cuenta podrá aceptarla, una vez, durante 7 días. Escribe un correo válido.",
      ),
    );
    await userEvent.type(within(sheet).getByLabelText("Correo de la persona"), "example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Enviar invitación" }));
    expect(
      await within(sheet).findByText(
        "Hearth todavía no envía correos: copia el enlace y compártelo con marta@example.com.",
      ),
    ).toBeInTheDocument();
    expect(within(sheet).getByLabelText("Enlace de invitación")).toHaveValue(
      "https://hearth.example/invitations/AbC",
    );
    expect(await requests[1]!.json()).toEqual({
      kind: "EMAIL",
      email: "marta@example.com",
      role: "MEMBER",
    });
  });

  it("says the invitation was sent when the API sent the email", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": () =>
        created({ kind: "EMAIL", email: "marta@example.com" }, true),
    });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Correo" }));
    await userEvent.type(within(sheet).getByLabelText("Correo de la persona"), "marta@example.com");
    await userEvent.click(within(sheet).getByRole("button", { name: "Enviar invitación" }));
    expect(
      await within(sheet).findByText("Le enviamos la invitación a marta@example.com."),
    ).toBeInTheDocument();
    expect(await requests[0]!.json()).toEqual({
      kind: "EMAIL",
      email: "marta@example.com",
      role: "MEMBER",
    });
  });

  it("shows any other problem as a notice (AlreadyMember)", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations": () => problemResponse(409, "AlreadyMember"),
    });
    screenAs("u-ana", "OWNER", api);
    const sheet = await openInvite();
    await userEvent.click(within(sheet).getByRole("button", { name: "Crear enlace" }));
    expect(await within(sheet).findByRole("alert")).toBeInTheDocument();
    expect(within(sheet).queryByLabelText("Enlace de invitación")).not.toBeInTheDocument();
  });

  it("lists the pending invitations with their role and expiry, and revokes one", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": () =>
        jsonResponse({ ...PENDING[0], status: "REVOKED" }),
    });
    screenAs("u-ana", "OWNER", api, PENDING);
    const pending = screen.getByRole("region", { name: "Invitaciones pendientes" });
    expect(normalized(pending.textContent)).toContain(
      "marta@example.comCorreo · Miembro · vence el 26/10/2026",
    );
    expect(normalized(pending.textContent)).toContain(
      "Enlace de invitaciónLector · varias personas · vence el 24/10/2026",
    );
    expect(within(pending).queryByRole("button", { name: /Copiar/ })).not.toBeInTheDocument();
    expect(
      within(pending).getByRole("button", { name: "Revocar el enlace de invitación como Lector" }),
    ).toBeInTheDocument();
    const revokeButton = within(pending).getByRole("button", {
      name: "Revocar la invitación de marta@example.com",
    });
    await userEvent.click(revokeButton);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/invitations/inv-2/revoke");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it("disables Revoke while the request is in flight", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": async () => {
        await gate;
        return jsonResponse({ ...PENDING[0], status: "REVOKED" });
      },
    });
    screenAs("u-ana", "OWNER", api, PENDING);
    const button = screen.getByRole("button", { name: "Revocar la invitación de marta@example.com" });
    await userEvent.dblClick(button);
    expect(button).toBeDisabled();
    expect(requests).toHaveLength(1);
    release();
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("shows a problem above the list when revoking fails, and renders nothing without invitations", async () => {
    const { api } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/invitations/{invitationId}/revoke": () =>
        problemResponse(404, "InvitationNotFound"),
    });
    const { unmount } = screenAs("u-ana", "OWNER", api, PENDING);
    await userEvent.click(screen.getByRole("button", { name: "Revocar la invitación de marta@example.com" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    unmount();
    screenAs("u-ana", "OWNER", api, []);
    expect(screen.queryByRole("region", { name: "Invitaciones pendientes" })).not.toBeInTheDocument();
  });
});

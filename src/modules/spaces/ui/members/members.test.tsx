import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { guestDto, householdSpace, memberDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
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
  api: Api = fakeApi({}).api,
  space = householdSpace({ role }),
) =>
  renderWithIntl(
    <MembersScreen
      space={space}
      members={MEMBERS}
      meUserId={meUserId}
      formats={BUILT_IN_FORMATS}
      viewerZone="America/Bogota"
      api={api}
    />,
  );
const rowOf = (name: string) => screen.getByRole("listitem", { name });
const roleButtons = () => screen.queryAllByRole("button", { name: /^Rol de/ });

describe("members screen (HU-E9-05)", () => {
  it("lists every member with their role, the viewer and the guest marked", async () => {
    const { container } = screenAs("u-ana", "OWNER");
    expect(screen.getByRole("heading", { level: 1, name: "Miembros" })).toBeInTheDocument();
    expect(screen.getByText("Household · COP · mensual, corte el 1")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "5 miembros" })).toBeInTheDocument();
    expect(within(rowOf("Ana (tú)")).getByText("Propietario")).toBeInTheDocument();
    expect(within(rowOf("Juan")).getByText("Se unió el 3/10/2026")).toBeInTheDocument();
    expect(within(rowOf("Pedro (invitado)")).getByText("Sin cuenta · no inicia sesión")).toBeInTheDocument();
    expect(within(rowOf("Pedro (invitado)")).getByText("Sin rol")).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("lets the OWNER change Juan's role, and never her own", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/members/{memberId}": () =>
        jsonResponse({ ...MEMBERS[1], role: "MEMBER" }),
    });
    screenAs("u-ana", "OWNER", api);
    expect(within(rowOf("Ana (tú)")).queryByRole("button")).not.toBeInTheDocument();
    expect(
      within(rowOf("Pedro (invitado)")).queryByRole("button", { name: /^Rol de/ }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rol de Juan: Administrador. Cambiar" }));
    const sheet = screen.getByRole("dialog", { name: "Rol de Juan" });
    expect(within(sheet).getByRole("radio", { name: /Administrador/ })).toBeChecked();
    expect(within(sheet).getByRole("button", { name: "Guardar rol" })).toBeDisabled();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Miembro/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar rol" }));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-household/members/m-juan");
    expect(await requests[0]!.json()).toEqual({ role: "MEMBER" });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the sheet open with LastOwnerRequired when the last owner is demoted", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/members/{memberId}": () => problemResponse(409, "LastOwnerRequired"),
    });
    renderWithIntl(
      <MembersScreen
        space={householdSpace({ role: "OWNER" })}
        members={[
          memberDto(),
          memberDto({ id: "m-bea", userId: "u-bea", displayName: "Bea", role: "OWNER" }),
        ]}
        meUserId="u-bea"
        formats={BUILT_IN_FORMATS}
        viewerZone="America/Bogota"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Rol de Ana: Propietario. Cambiar" }));
    await userEvent.click(screen.getByRole("radio", { name: /Lector/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar rol" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El espacio necesita al menos un propietario. Nombra otro primero.",
    );
    expect(screen.getByRole("dialog", { name: "Rol de Ana" })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("shows the API's InsufficientRole refusal as its own message and keeps the sheet open", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/spaces/{spaceId}/members/{memberId}": () => problemResponse(403, "InsufficientRole"),
    });
    screenAs("u-ana", "OWNER", api);
    await userEvent.click(screen.getByRole("button", { name: "Rol de Luis: Miembro. Cambiar" }));
    await userEvent.click(screen.getByRole("radio", { name: /Lector/ }));
    await userEvent.click(screen.getByRole("button", { name: "Guardar rol" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No tienes permiso para hacer esto en este espacio.",
    );
    expect(screen.getByRole("dialog", { name: "Rol de Luis" })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("offers an ADMIN and a MEMBER no role control and no read-only note", () => {
    for (const [uid, role] of [
      ["u-juan", "ADMIN"],
      ["u-luis", "MEMBER"],
    ] as const) {
      const { unmount } = screenAs(uid, role);
      expect(roleButtons()).toHaveLength(0);
      expect(screen.queryByText(/Tu rol en Household es/)).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows a VIEWER no control and the read-only note", () => {
    screenAs("u-sofi", "VIEWER");
    expect(roleButtons()).toHaveLength(0);
    expect(
      screen.getByText(
        "Tu rol en Household es Lector: puedes ver miembros y saldos, pero no invitar ni agregar invitados.",
      ),
    ).toBeInTheDocument();
  });

  it("says a direct space takes nobody else", () => {
    screenAs("u-ana", "OWNER", fakeApi({}).api, householdSpace({ kind: "DIRECT", name: "Ana & Juan" }));
    expect(
      screen.getByText("Ana & Juan es un espacio solo para dos: no admite más miembros."),
    ).toBeInTheDocument();
    expect(roleButtons()).toHaveLength(0);
  });

  it("writes the semi-monthly policy and the labels in English", () => {
    renderWithIntl(
      <MembersScreen
        space={householdSpace({ periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } })}
        members={MEMBERS}
        meUserId="u-ana"
        formats={BUILT_IN_FORMATS}
        viewerZone="America/Bogota"
        api={fakeApi({}).api}
      />,
      { locale: "en" },
    );
    expect(screen.getByText("Household · COP · twice a month, days 1 and 16")).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Ana (you)" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: "Pedro (guest)" })).toBeInTheDocument();
  });
});

describe("members screen: the way back (S1)", () => {
  it("has a Volver link to the home of the space, whatever the role", () => {
    screenAs("u-sofi", "VIEWER");
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
  });
});

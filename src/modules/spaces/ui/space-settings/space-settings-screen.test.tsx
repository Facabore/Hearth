import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { householdSpace, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { SpaceSettingsScreen } from "./space-settings-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const links = () =>
  within(screen.getByRole("navigation"))
    .getAllByRole("link")
    .map((link) => [link.textContent, link.getAttribute("href")]);

describe("a space's own settings (ruling P309)", () => {
  it("gives the OWNER of a shared space its screens, its name and color, Salir and Archivar", async () => {
    renderWithIntl(
      <SpaceSettingsScreen
        space={householdSpace({ color: "SKY" })}
        homeHref="/spaces/sp-personal"
        api={fakeApi({}).api}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: "Ajustes de Household" })).toBeInTheDocument();
    expect(screen.getByText("Compartido · COP · mensual, corte el 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
    expect(links()).toEqual([
      ["Miembros e invitados", "/spaces/sp-household/members"],
      ["Categorías", "/spaces/sp-household/categories"],
      ["Cuentas y fondos", "/spaces/sp-household/accounts"],
    ]);
    expect(await screen.findByLabelText("Nombre del espacio", {}, { timeout: 10_000 })).toHaveValue(
      "Household",
    );
    expect(screen.getByRole("button", { name: "Salir de Household" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivar Household" })).toBeInTheDocument();
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("shows a MEMBER the space's name and color without changing them, and only Salir", () => {
    renderWithIntl(
      <SpaceSettingsScreen
        space={householdSpace({ role: "MEMBER", color: "SKY" })}
        homeHref="/spaces/sp-personal"
        api={fakeApi({}).api}
      />,
    );
    expect(links().map(([label]) => label)).toEqual([
      "Miembros e invitados",
      "Categorías",
      "Cuentas y fondos",
    ]);
    expect(screen.queryByLabelText("Nombre del espacio")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nombre y color" })).toBeInTheDocument();
    expect(screen.getByText("Household", { selector: "[data-space-chip]" })).toBeInTheDocument();
    expect(
      screen.getByText("Solo quienes administran Household cambian su nombre y su color."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salir de Household" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archivar Household" })).not.toBeInTheDocument();
  });

  it("gives the personal space only its categories, its accounts and its name: nothing to leave or archive", async () => {
    renderWithIntl(
      <SpaceSettingsScreen space={spaceDto()} homeHref="/spaces/sp-personal" api={fakeApi({}).api} />,
    );
    expect(screen.getByText("Solo tú · COP · mensual, corte el 1")).toBeInTheDocument();
    expect(links()).toEqual([
      ["Categorías", "/spaces/sp-personal/categories"],
      ["Cuentas", "/spaces/sp-personal/accounts"],
    ]);
    expect(await screen.findByLabelText("Nombre del espacio", {}, { timeout: 10_000 })).toHaveValue(
      "Personal",
    );
    expect(screen.queryByRole("radiogroup", { name: "Color" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salir|Archivar/ })).not.toBeInTheDocument();
  });

  it("lets the OWNER of a direct space archive it, never leave it", () => {
    renderWithIntl(
      <SpaceSettingsScreen
        space={householdSpace({ kind: "DIRECT", name: "Ana y Juan" })}
        homeHref="/spaces/sp-personal"
        api={fakeApi({}).api}
      />,
    );
    expect(links().map(([label]) => label)).toEqual(["Miembros e invitados", "Categorías", "Cuentas"]);
    expect(screen.queryByRole("button", { name: "Salir de Ana y Juan" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archivar Ana y Juan" })).toBeInTheDocument();
  });

  it("asks before leaving, then leaves and lands on the personal space's home", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/leave": () => new Response(null, { status: 204 }),
    });
    renderWithIntl(
      <SpaceSettingsScreen
        space={householdSpace({ role: "MEMBER" })}
        homeHref="/spaces/sp-personal"
        api={api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Salir de Household" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Salir de Household?" }, { timeout: 10_000 });
    expect(requests).toHaveLength(0);
    await userEvent.click(within(sheet).getByRole("button", { name: "Salir de Household" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal"));
    expect(requests.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ["POST", "/api/v1/spaces/sp-household/leave"],
    ]);
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps the API's refusal to archive in the sheet, and Cancelar closes it without archiving", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/archive": () => problemResponse(409, "OutstandingBalance"),
    });
    renderWithIntl(<SpaceSettingsScreen space={householdSpace()} homeHref="/spaces/sp-personal" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Archivar Household" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Archivar Household?" }, { timeout: 10_000 });
    await userEvent.click(within(sheet).getByRole("button", { name: "Archivar Household" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/los saldos tienen que quedar en cero/);
    expect(router.replace).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(requests).toHaveLength(1);
  });
});

import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { householdSpace, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { SpaceSettingsScreen } from "./space-settings-screen";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const personal = spaceDto();
const spaces = [personal, householdSpace()];

const render = (props: Partial<ComponentProps<typeof SpaceSettingsScreen>> = {}) =>
  renderWithIntl(
    <SpaceSettingsScreen
      space={householdSpace({ color: "SKY" })}
      spaces={spaces}
      homeHref="/spaces/sp-personal"
      api={fakeApi({}).api}
      {...props}
    />,
  );

/** The list's rows that open another screen, by their label and address. */
const links = () =>
  within(screen.getByRole("navigation"))
    .getAllByRole("link")
    .map((link) => [link.querySelector("[data-row-label]")?.textContent, link.getAttribute("href")]);

const sections = () =>
  within(screen.getByRole("navigation"))
    .getAllByRole("heading", { level: 2 })
    .map((heading) => heading.textContent);

describe("a space's Configuración (ruling P311, amends P309)", () => {
  it("titles the screen Configuración, names the space in a dropdown under it and lists one flat list by section", async () => {
    render();
    expect(screen.getByRole("heading", { level: 1, name: "Configuración" })).toBeInTheDocument();
    const pick = screen.getByRole("button", { name: "Household" });
    expect(pick).toHaveAttribute("aria-expanded", "false");
    expect(pick).toHaveClass("text-accent");
    expect(pick).not.toHaveClass("rounded-full");
    expect(screen.getByText("Compartido · COP · mensual, corte el 1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
    expect(sections()).toEqual(["Plan", "Personas", "Dinero", "Espacio"]);
    expect(links()).toEqual([
      ["Plan del mes", "/spaces/sp-household/plan"],
      ["Miembros e invitados", "/spaces/sp-household/members"],
      ["Cuentas y fondos", "/spaces/sp-household/accounts"],
      ["Categorías", "/spaces/sp-household/categories"],
      ["Recurrentes", "/spaces/sp-household/recurrences"],
    ]);
    // No cards inside cards: the list is flat on the page.
    expect(screen.getByRole("navigation").querySelector(".border")).toBeNull();
    expect(screen.getByRole("button", { name: "Nombre y color" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salir de Household/ })).toHaveClass("text-danger");
    expect(screen.getByRole("button", { name: /Archivar Household/ })).toHaveClass("text-danger");
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("shows each row's status on its right: what the plan has left, the people and what waits to be confirmed", () => {
    render({ status: { plan: "Quedan $ 380.000", members: "4 personas", recurring: "2 por confirmar" } });
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByRole("link", { name: /Plan del mes/ })).toHaveTextContent("Quedan $ 380.000");
    expect(within(nav).getByRole("link", { name: /Miembros e invitados/ })).toHaveTextContent("4 personas");
    expect(within(nav).getByRole("link", { name: /Recurrentes/ })).toHaveTextContent("2 por confirmar");
  });

  it("switches which space it configures from the dropdown: each current space, the current one checked", async () => {
    render({ people: { "sp-household": 4 } });
    await userEvent.click(screen.getByRole("button", { name: "Household" }));
    expect(screen.getByRole("button", { name: "Household" })).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("list", { name: "Espacios" });
    const options = within(menu).getAllByRole("link");
    expect(options.map((link) => link.getAttribute("href"))).toEqual([
      "/spaces/sp-personal/settings",
      "/spaces/sp-household/settings",
    ]);
    expect(options[0]).toHaveTextContent("PersonalSolo tú");
    expect(options[1]).toHaveTextContent("HouseholdCompartido · 4 personas");
    expect(options[1]).toHaveAttribute("aria-current", "true");
    expect(options[1]!.querySelector("svg")).not.toBeNull();
    expect(options[0]).not.toHaveAttribute("aria-current");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("list", { name: "Espacios" })).not.toBeInTheDocument();
  });

  it("gives the OWNER the space's name and color behind Nombre y color", async () => {
    render();
    expect(screen.queryByLabelText("Nombre del espacio")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Nombre y color" }));
    expect(screen.getByRole("button", { name: "Nombre y color" })).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByLabelText("Nombre del espacio", {}, { timeout: 10_000 })).toHaveValue(
      "Household",
    );
  });

  it("shows a MEMBER the space's name and color without changing them, and only Salir", async () => {
    render({ space: householdSpace({ role: "MEMBER", color: "SKY" }) });
    await userEvent.click(screen.getByRole("button", { name: "Nombre y color" }));
    expect(screen.queryByLabelText("Nombre del espacio")).not.toBeInTheDocument();
    expect(screen.getByText("Household", { selector: "[data-space-chip]" })).toBeInTheDocument();
    expect(
      screen.getByText("Solo quienes administran Household cambian su nombre y su color."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salir de Household/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Archivar Household/ })).not.toBeInTheDocument();
  });

  it("gives the personal space no Personas, its Cuentas and its Nombre: nothing to leave or archive", async () => {
    render({ space: personal });
    expect(screen.getByText("Solo tú · COP · mensual, corte el 1")).toBeInTheDocument();
    expect(sections()).toEqual(["Plan", "Dinero", "Espacio"]);
    expect(links()).toEqual([
      ["Plan del mes", "/spaces/sp-personal/plan"],
      ["Cuentas", "/spaces/sp-personal/accounts"],
      ["Categorías", "/spaces/sp-personal/categories"],
      ["Recurrentes", "/spaces/sp-personal/recurrences"],
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Nombre" }));
    expect(await screen.findByLabelText("Nombre del espacio", {}, { timeout: 10_000 })).toHaveValue(
      "Personal",
    );
    expect(screen.queryByRole("radiogroup", { name: "Color" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salir|Archivar/ })).not.toBeInTheDocument();
  });

  it("lets the OWNER of a direct space archive it, never leave it", () => {
    render({ space: householdSpace({ kind: "DIRECT", name: "Ana y Juan" }) });
    expect(links().map(([label]) => label)).toEqual([
      "Plan del mes",
      "Miembros e invitados",
      "Cuentas",
      "Categorías",
      "Recurrentes",
    ]);
    expect(screen.queryByRole("button", { name: /Salir de Ana y Juan/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Archivar Ana y Juan/ })).toBeInTheDocument();
  });

  it("asks before leaving, then leaves and lands on the personal space's home", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/leave": () => new Response(null, { status: 204 }),
    });
    render({ space: householdSpace({ role: "MEMBER" }), api });
    await userEvent.click(screen.getByRole("button", { name: /Salir de Household/ }));
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
    render({ space: householdSpace(), api });
    await userEvent.click(screen.getByRole("button", { name: /Archivar Household/ }));
    const sheet = await screen.findByRole("dialog", { name: "¿Archivar Household?" }, { timeout: 10_000 });
    await userEvent.click(within(sheet).getByRole("button", { name: "Archivar Household" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(/los saldos tienen que quedar en cero/);
    expect(router.replace).not.toHaveBeenCalled();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(requests).toHaveLength(1);
  });
});

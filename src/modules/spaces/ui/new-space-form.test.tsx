import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { householdSpace } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { NewSpaceForm } from "./new-space-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

describe("new shared space (HU-E9-05, ruling P161)", () => {
  it("creates Household in COP and opens its members screen", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces": () => jsonResponse(householdSpace(), 201) });
    const { container } = renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={api} />);
    expect(screen.getByRole("combobox", { name: "Moneda" })).toHaveValue("COP");
    await userEvent.type(screen.getByLabelText("Nombre"), " Household ");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    expect(await requests[0]!.json()).toEqual({
      kind: "SHARED",
      name: "Household",
      currency: "COP",
      periodPolicy: { kind: "MONTHLY", day: 1 },
    });
    expect(router.replace).toHaveBeenCalledWith("/spaces/sp-household/members");
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("puts InvalidSpaceName under the name and creates nothing else", async () => {
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces": () => problemResponse(422, "InvalidSpaceName"),
    });
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={api} />);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Moneda" }), "USD");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Nombre")).toHaveAccessibleDescription(
        "El nombre del espacio debe tener entre 1 y 80 caracteres.",
      ),
    );
    expect(await requests[0]!.json()).toMatchObject({ currency: "USD" });
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("new shared space as its board (E9-05 · 07, ruling P272)", () => {
  it("labels the currency Moneda, a select of the three currencies, with its hint", () => {
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={fakeApi({}).api} />);
    const currency = screen.getByRole("combobox", { name: "Moneda" });
    expect(Array.from(currency.querySelectorAll("option")).map((option) => option.textContent)).toEqual([
      "COP · Peso colombiano",
      "USD · Dólar estadounidense",
      "EUR · Euro",
    ]);
    expect(currency).toHaveAccessibleDescription(
      "Una sola moneda por espacio. Deja de poder cambiarse cuando el espacio tiene movimientos.",
    );
    expect(currency).toHaveClass("h-[52px]");
  });

  it("names the space being created in the owner note, live", async () => {
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={fakeApi({}).api} />);
    expect(
      screen.getByText(
        "Quedarás como Propietario y el espacio pasará a ser tu espacio activo. Después invitas a los demás desde Miembros.",
      ),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nombre"), " Hogar ");
    expect(
      screen.getByText(
        "Quedarás como Propietario y Hogar pasará a ser tu espacio activo. Después invitas a los demás desde Miembros.",
      ),
    ).toBeInTheDocument();
  });

  it("draws no page header inside the switcher's sheet, and tells the sheet once the space exists", async () => {
    const onCreated = vi.fn();
    const { api } = fakeApi({ "POST /api/v1/spaces": () => jsonResponse(householdSpace(), 201) });
    renderWithIntl(<NewSpaceForm api={api} onCreated={onCreated} />);
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Volver" })).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Nombre"), "Household");
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    // The screen under the sheet stays in the history: Volver and Back return to it.
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/members");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("new shared space with its budget period (#240, board Crear espacio compartido)", () => {
  it("draws Período del presupuesto as Mensual or Quincenal, the cut-off day beside its label, and the line under them", async () => {
    const { container } = renderWithIntl(
      <NewSpaceForm backHref="/spaces/sp-personal" api={fakeApi({}).api} />,
    );
    const period = screen.getByRole("group", { name: "Período del presupuesto" });
    expect(within(period).getByRole("radio", { name: "Mensual" })).toBeChecked();
    expect(within(period).getByRole("radio", { name: "Quincenal" })).not.toBeChecked();
    const day = within(period).getByRole("textbox", { name: "Día de corte" });
    expect(day).toHaveValue("1");
    expect(day).toHaveAttribute("inputmode", "numeric");
    // The policy as Miembros names it, capitalized by the line's style ("Mensual, corte el 1").
    expect(day).toHaveAccessibleDescription("mensual, corte el 1");
    await userEvent.clear(day);
    await userEvent.type(day, "25x7");
    expect(day).toHaveValue("25");
    expect(screen.getByText("mensual, corte el 25")).toHaveClass("first-letter:uppercase");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("sends the policy picked: twice a month on the days typed", async () => {
    const { api, requests } = fakeApi({ "POST /api/v1/spaces": () => jsonResponse(householdSpace(), 201) });
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={api} />);
    await userEvent.type(screen.getByLabelText("Nombre"), "Household");
    await userEvent.click(screen.getByRole("radio", { name: "Quincenal" }));
    expect(screen.queryByRole("textbox", { name: "Día de corte" })).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Primer corte" })).toHaveValue("1");
    const second = screen.getByRole("textbox", { name: "Segundo corte" });
    await userEvent.clear(second);
    await userEvent.type(second, "20");
    expect(screen.getByText("quincenal, días 1 y 20")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    expect(await requests[0]!.json()).toMatchObject({
      periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 20 },
    });
  });

  it("puts InvalidPeriodPolicy under the period and keeps the person on the form", async () => {
    const { api } = fakeApi({ "POST /api/v1/spaces": () => problemResponse(422, "InvalidPeriodPolicy") });
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-personal" api={api} />);
    await userEvent.type(screen.getByLabelText("Nombre"), "Household");
    await userEvent.clear(screen.getByRole("textbox", { name: "Día de corte" }));
    await userEvent.click(screen.getByRole("button", { name: "Crear espacio" }));
    const day = screen.getByRole("textbox", { name: "Día de corte" });
    await waitFor(() => expect(day).toBeInvalid());
    expect(day).toHaveAccessibleDescription("La forma de contar los periodos no es válida.");
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("new shared space: the way back (S1)", () => {
  it("has a Volver link to the given space home, next to the title", () => {
    renderWithIntl(<NewSpaceForm backHref="/spaces/sp-household" api={fakeApi({}).api} />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
    expect(
      screen.getByRole("heading", { level: 1, name: "Crear un espacio compartido" }),
    ).toBeInTheDocument();
  });
});

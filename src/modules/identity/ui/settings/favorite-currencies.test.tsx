import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { meDto, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { SettingsForm } from "./settings-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

// P342 (S2, board 6): Ajustes › Monedas favoritas, a star per currency; the favorites are what a picker offers first.
const personal = { name: "Personal", currency: "COP" };
const withFavorites = (favoriteCurrencies?: string[]) =>
  meDto({
    preferences: { ...meDto().preferences, ...(favoriteCurrencies ? { favoriteCurrencies } : {}) },
  });

/** A PATCH /me that stores what it is sent, recording each body. */
const storingApi = () => {
  const bodies: { favoriteCurrencies?: string[] }[] = [];
  const { api } = fakeApi({
    "PATCH /api/v1/me": async (request) => {
      const body = (await request.json()) as { favoriteCurrencies?: string[] };
      bodies.push(body);
      return jsonResponse(withFavorites(body.favoriteCurrencies));
    },
  });
  return { api, bodies };
};

// The sheet hides what is behind it from assistive technology while it is open.
const row = () => screen.getByRole("button", { name: /^Monedas favoritas/, hidden: true });
const openSheet = async () => {
  await userEvent.click(row());
  return screen.findByRole("dialog", { name: "Monedas favoritas" }, { timeout: 10_000 });
};
const starsIn = (sheet: HTMLElement, region: RegExp) =>
  within(within(sheet).getByRole("region", { name: region }))
    .getAllByRole("button")
    .map((star) => star.getAttribute("aria-label"));
const FAVORITES = /^Favoritas · salen primero$/i;
const ALL = /^Todas · toca la estrella para agregar$/i;

describe("settings: favorite currencies (P342, board 6)", () => {
  it("shows the personal space's currency as the only favorite until the person chooses some", async () => {
    renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={meDto()}
        personalSpace={personal}
        api={fakeApi({}).api}
      />,
    );
    expect(normalized(row().textContent)).toBe("Monedas favoritasCOP");
    const sheet = await openSheet();
    expect(starsIn(sheet, FAVORITES)).toEqual(["Quitar COP de favoritas"]);
  });

  it("lists the favorites with a filled star, in their order, then every other currency with an empty one", async () => {
    const { container } = renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={withFavorites(["COP", "USD", "EUR", "MXN"])}
        personalSpace={personal}
        api={fakeApi({}).api}
      />,
    );
    expect(normalized(row().textContent)).toBe("Monedas favoritasCOP · USD · EUR · MXN");
    const sheet = await openSheet();
    const search = within(sheet).getByLabelText("Agregar una moneda");
    expect(search).toHaveAttribute("placeholder", "Busca por nombre o código");
    expect(starsIn(sheet, FAVORITES)).toEqual([
      "Quitar COP de favoritas",
      "Quitar USD de favoritas",
      "Quitar EUR de favoritas",
      "Quitar MXN de favoritas",
    ]);
    const favorites = within(sheet).getByRole("region", { name: FAVORITES });
    const first = within(favorites).getAllByRole("listitem")[0]!;
    // The badge is the code, and the line under the name says it is the personal space's.
    expect(normalized(first.textContent)).toBe("COPPeso colombianoCOP · la de Personal");
    for (const star of within(favorites).getAllByRole("button")) {
      expect(star).toHaveAttribute("aria-pressed", "true");
      expect(star.className).toMatch(/\bsize-11\b/);
      // A favorite's star is filled; any other's is only drawn.
      expect(star.querySelector("svg")).toHaveClass("fill-current");
    }
    const all = starsIn(sheet, ALL);
    expect(all).toContain("Agregar BRL a favoritas");
    expect(all).not.toContain("Agregar USD a favoritas");
    const jpy = within(within(sheet).getByRole("region", { name: ALL })).getByRole("button", {
      name: "Agregar JPY a favoritas",
    });
    expect(jpy).toHaveAttribute("aria-pressed", "false");
    expect(jpy.querySelector("svg")).not.toHaveClass("fill-current");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("adds a favorite with its star and saves the whole list", async () => {
    const { api, bodies } = storingApi();
    renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={withFavorites(["COP", "USD"])}
        personalSpace={personal}
        api={api}
      />,
    );
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar BRL a favoritas" }));
    // Optimistic: the currency moves at once.
    expect(starsIn(sheet, FAVORITES)).toEqual([
      "Quitar COP de favoritas",
      "Quitar USD de favoritas",
      "Quitar BRL de favoritas",
    ]);
    await waitFor(() => expect(bodies).toEqual([{ favoriteCurrencies: ["COP", "USD", "BRL"] }]));
    await waitFor(() => expect(normalized(row().textContent)).toBe("Monedas favoritasCOP · USD · BRL"));
  });

  it("removes a favorite with its star, and starts from the personal space's when none were chosen", async () => {
    const { api, bodies } = storingApi();
    renderWithIntl(
      <SettingsForm backHref="/spaces/sp-personal" me={meDto()} personalSpace={personal} api={api} />,
    );
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar USD a favoritas" }));
    await waitFor(() => expect(bodies).toEqual([{ favoriteCurrencies: ["COP", "USD"] }]));
    await userEvent.click(within(sheet).getByRole("button", { name: "Quitar COP de favoritas" }));
    await waitFor(() => expect(bodies.at(-1)).toEqual({ favoriteCurrencies: ["USD"] }));
    expect(starsIn(sheet, FAVORITES)).toEqual(["Quitar USD de favoritas"]);
    expect(starsIn(sheet, ALL)).toContain("Agregar COP a favoritas");
  });

  it("rolls the star back and says why when the change is refused", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => problemResponse(422, "UnknownCurrency") });
    renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={withFavorites(["COP"])}
        personalSpace={personal}
        api={api}
      />,
    );
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: "Agregar EUR a favoritas" }));
    expect(await within(sheet).findByText("Esa moneda no está disponible.")).toBeInTheDocument();
    expect(starsIn(sheet, FAVORITES)).toEqual(["Quitar COP de favoritas"]);
    expect(normalized(row().textContent)).toBe("Monedas favoritasCOP");
  });

  it("finds a currency by its name or its code, accents ignored", async () => {
    renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={withFavorites(["COP", "USD"])}
        personalSpace={personal}
        api={fakeApi({}).api}
      />,
    );
    const sheet = await openSheet();
    const search = within(sheet).getByLabelText("Agregar una moneda");
    await userEvent.type(search, "japones");
    expect(within(sheet).queryByRole("region", { name: FAVORITES })).toBeNull();
    expect(starsIn(sheet, ALL)).toEqual(["Agregar JPY a favoritas"]);
    await userEvent.clear(search);
    await userEvent.type(search, "usd");
    expect(starsIn(sheet, FAVORITES)).toEqual(["Quitar USD de favoritas"]);
    expect(within(sheet).queryByRole("region", { name: ALL })).toBeNull();
  });

  it("are what the display currency's sheet offers after the personal space's own", async () => {
    renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={withFavorites(["EUR", "COP"])}
        personalSpace={personal}
        api={fakeApi({}).api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Moneda de tus totales/ }));
    const sheet = await screen.findByRole("dialog", { name: "Moneda de tus totales" });
    expect(
      within(sheet)
        .getAllByRole("heading", { level: 3 })
        .map((h) => h.textContent),
    ).toEqual(["De tu espacio Personal", "Favoritas", "Todas"]);
    expect(
      within(within(sheet).getByRole("region", { name: "Favoritas" })).getByRole("button"),
    ).toHaveTextContent("Euro");
  });

  it("names each star in English too", async () => {
    renderWithIntl(
      <SettingsForm
        backHref="/spaces/sp-personal"
        me={withFavorites(["USD"])}
        personalSpace={personal}
        api={fakeApi({}).api}
      />,
      { locale: "en" },
    );
    await userEvent.click(screen.getByRole("button", { name: /^Favorite currencies/ }));
    const sheet = await screen.findByRole("dialog", { name: "Favorite currencies" }, { timeout: 10_000 });
    expect(within(sheet).getByRole("button", { name: "Remove USD from favorites" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Add EUR to favorites" })).toBeInTheDocument();
  });
});

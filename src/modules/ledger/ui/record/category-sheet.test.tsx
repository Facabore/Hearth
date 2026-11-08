import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { CategoryChoice } from "@/modules/categories/ui";
import { CategorySheet, type CategoryCreation } from "./category-sheet";
import type { RecentCategory } from "./recent-categories";

const market = categoryDto({
  id: "c-market",
  groupId: "g-food",
  name: "Mercado",
  subcategories: [
    categoryDto({ id: "c-veg", groupId: "g-food", name: "Verduras", parentCategoryId: "c-market" }),
    categoryDto({ id: "c-meat", groupId: "g-food", name: "Carnes", parentCategoryId: "c-market" }),
  ],
});
const groups = [
  groupDto({
    id: "g-home",
    key: "home",
    name: "Vivienda",
    categories: [categoryDto({ id: "c-rent", groupId: "g-home", name: "Arriendo" })],
  }),
  groupDto({
    id: "g-food",
    name: "Alimentación",
    categories: [market, categoryDto({ id: "c-dining", name: "Restaurantes" })],
  }),
  groupDto({ id: "g-old", key: "old", name: "Vieja", archivedAt: "2026-01-01T00:00:00Z", categories: [] }),
];

const open = (
  value: CategoryChoice = null,
  recent: readonly RecentCategory[] = [],
  extra: { creation?: CategoryCreation; personal?: boolean } = {},
) => {
  const onChoose = vi.fn();
  const onOpenChange = vi.fn();
  const view = renderWithIntl(
    <CategorySheet
      open
      onOpenChange={onOpenChange}
      groups={groups}
      value={value}
      onChoose={onChoose}
      recent={recent}
      space={{ id: "s-trip", name: "Viaje", kind: extra.personal ? "PERSONAL" : "SHARED" }}
      {...(extra.creation ? { creation: extra.creation } : {})}
    />,
  );
  return { ...view, onChoose, onOpenChange, sheet: screen.getByRole("dialog", { name: "Categoría" }) };
};

describe("the record form's category picker (ruling P291, board B1 · 03)", () => {
  it("goes back to the form with a chevron, searches with a magnifier, and keeps axe clean", async () => {
    const { sheet, onOpenChange, baseElement } = open();
    expect(within(sheet).queryByRole("button", { name: "Cerrar" })).toBeNull();
    expect(within(sheet).getByRole("searchbox", { name: "Buscar categoría" })).toHaveAttribute(
      "placeholder",
      "Buscar categoría",
    );
    expect(await axeViolations(baseElement)).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Volver" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("offers the recent categories as chips that choose at once", async () => {
    const { sheet, onChoose, onOpenChange } = open(null, [
      { categoryId: "c-market", subcategoryId: "c-veg" },
    ]);
    const recent = within(sheet).getByRole("heading", { name: "Recientes" }).parentElement!;
    await userEvent.click(within(recent).getByRole("button", { name: "Mercado › Verduras" }));
    expect(onChoose).toHaveBeenCalledWith({ categoryId: "c-market", subcategoryId: "c-veg" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("lists the live groups as tiles under Todas, each opening its categories in a panel", async () => {
    const { sheet, onChoose } = open();
    const all = within(sheet).getByRole("heading", { name: "Todas" }).parentElement!;
    const tiles = within(all)
      .getAllByRole("button", { expanded: false })
      .concat(within(all).getAllByRole("button", { expanded: true }));
    expect(tiles.map((tile) => tile.textContent).sort()).toEqual(["Alimentación", "Vivienda"]);
    // With nothing chosen, the first group is open.
    expect(within(all).getByRole("button", { name: "Vivienda" })).toHaveAttribute("aria-expanded", "true");
    expect(within(sheet).queryByRole("radio", { name: "Mercado" })).toBeNull();
    await userEvent.click(within(all).getByRole("button", { name: "Alimentación" }));
    expect(within(all).getByRole("button", { name: "Alimentación" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await userEvent.click(within(sheet).getByRole("radio", { name: "Restaurantes" }));
    expect(onChoose).toHaveBeenCalledWith({ categoryId: "c-dining", subcategoryId: null });
  });

  it("asks for a subcategory under a category that has them, Sin subcategoría first, and a tap chooses", async () => {
    const { sheet, onChoose, onOpenChange } = open({ categoryId: "c-market", subcategoryId: null });
    // The chosen category's group opens by itself, with its subcategory step.
    expect(within(sheet).getByText("Mercado · subcategoría opcional")).toBeInTheDocument();
    const subs = within(sheet).getByRole("radiogroup", { name: "Subcategorías de Mercado" });
    expect(
      within(subs)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["Sin subcategoría", "Verduras", "Carnes"]);
    expect(within(subs).getByRole("radio", { name: "Sin subcategoría" })).toBeChecked();
    await userEvent.click(within(subs).getByRole("radio", { name: "Sin subcategoría" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-market", subcategoryId: null });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await userEvent.click(within(subs).getByRole("radio", { name: "Carnes" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-market", subcategoryId: "c-meat" });
  });

  it("searches every group at once, and says when nothing matches", async () => {
    const { sheet, onChoose } = open();
    await userEvent.type(within(sheet).getByRole("searchbox"), "arri");
    expect(within(sheet).queryByRole("heading", { name: "Todas" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Arriendo" }));
    expect(onChoose).toHaveBeenCalledWith({ categoryId: "c-rent", subcategoryId: null });
    await userEvent.clear(within(sheet).getByRole("searchbox"));
    await userEvent.type(within(sheet).getByRole("searchbox"), "zz");
    expect(within(sheet).getByText("No hay ninguna categoría «zz».")).toBeInTheDocument();
  });
});

describe("a new category from the picker (ruling P308)", () => {
  const creating = (handler?: FakeHandler, personal = false) => {
    const onCreated = vi.fn();
    const { api, requests } = fakeApi({
      "POST /api/v1/spaces/{spaceId}/categories":
        handler ??
        (async (request) => {
          const body = await request.clone().json();
          return jsonResponse(categoryDto({ id: "c-new", ...body }), 201);
        }),
    });
    const view = open(null, [], {
      creation: { api, kind: "EXPENSE", onCreated },
      personal,
    });
    return { ...view, onCreated, requests };
  };

  it("names the space whose categories it shows, and offers no new one without a way to create it", () => {
    const { sheet } = open();
    expect(within(sheet).getByText("Categorías de Viaje")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Nueva categoría" })).toBeNull();
  });

  it("creates the category in the space and group the picker shows, and hands it back chosen", async () => {
    const { sheet, onCreated, onOpenChange, requests, baseElement } = creating();
    await userEvent.click(within(sheet).getByRole("button", { name: /Alimentación/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Nueva categoría" }));
    const form = screen.getByRole("dialog", { name: "Nueva categoría" });
    expect(within(form).getByText("En Viaje · la verán todos en el espacio")).toBeInTheDocument();
    // The group the picker was showing is the one chosen; any live group of the kind can be.
    // The form loads on the first "Nueva categoría", in a chunk of its own.
    const group = await within(form).findByRole("radiogroup", { name: "Grupo" });
    expect(within(group).getByRole("radio", { name: "Alimentación" })).toBeChecked();
    expect(within(group).queryByRole("radio", { name: "Vieja" })).toBeNull();
    const save = within(form).getByRole("button", { name: "Crear y usar en el gasto" });
    expect(save).toBeDisabled();
    await userEvent.type(within(form).getByLabelText("Nombre"), "  Bebidas en el hotel ");
    expect(await axeViolations(baseElement)).toEqual([]);
    await userEvent.click(save);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/s-trip/categories");
    expect(await requests[0]!.json()).toEqual({ groupId: "g-food", name: "Bebidas en el hotel" });
    expect(onCreated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c-new", name: "Bebidas en el hotel" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("turns a search with no match into the new category's name", async () => {
    const { sheet, requests } = creating();
    await userEvent.type(within(sheet).getByRole("searchbox"), "Pana");
    await userEvent.click(
      within(sheet).getByRole("button", {
        name: /Crear «Pana» como categoría.*En Viaje, sin salir del registro/,
      }),
    );
    const form = screen.getByRole("dialog", { name: "Nueva categoría" });
    expect(await within(form).findByLabelText("Nombre")).toHaveValue("Pana");
    await userEvent.click(within(form).getByRole("radio", { name: "Vivienda" }));
    await userEvent.click(within(form).getByRole("button", { name: "Crear y usar en el gasto" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(await requests[0]!.json()).toEqual({ groupId: "g-home", name: "Pana" });
  });

  it("says why it could not create, keeps what was typed, and goes back to the picker on cancel or Escape", async () => {
    const { sheet, onCreated, onOpenChange } = creating(() => problemResponse(409, "CategoryNameTaken"));
    await userEvent.click(within(sheet).getByRole("button", { name: "Nueva categoría" }));
    const form = screen.getByRole("dialog", { name: "Nueva categoría" });
    await userEvent.type(await within(form).findByLabelText("Nombre"), "Mercado");
    await userEvent.click(within(form).getByRole("button", { name: "Crear y usar en el gasto" }));
    expect(await within(form).findByRole("alert")).toHaveTextContent(
      "Ya hay una categoría con ese nombre aquí.",
    );
    expect(within(form).getByLabelText("Nombre")).toHaveValue("Mercado");
    expect(onCreated).not.toHaveBeenCalled();
    await userEvent.click(within(form).getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog", { name: "Categoría" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Nueva categoría" }),
    );
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "Categoría" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("tells the person that a personal space's category is theirs alone", async () => {
    const { sheet } = creating(undefined, true);
    await userEvent.click(within(sheet).getByRole("button", { name: "Nueva categoría" }));
    expect(screen.getByText("En Viaje · solo tú la ves")).toBeInTheDocument();
  });
});

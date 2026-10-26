import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { categoryDto, groupDto, householdSpace, spaceDto } from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { CategoryTree } from "./categories-screen";

type Node = CategoryGroupDto["categories"][number];

// HU-E3-01's seeded tree as Ana (locale "es") reads it: names are user data, shown as stored.
const SEEDED = [
  groupDto({
    id: "g-housing",
    name: "Vivienda",
    key: "housing",
    icon: { kind: "SYMBOL", name: "home" },
    color: "INDIGO",
    categories: [
      categoryDto({
        id: "c-rent",
        groupId: "g-housing",
        name: "Arriendo",
        key: "rent",
        icon: { kind: "SYMBOL", name: "key" },
        color: "INDIGO",
      }),
      categoryDto({
        id: "c-utilities",
        groupId: "g-housing",
        name: "Servicios",
        key: "utilities",
        icon: { kind: "SYMBOL", name: "bulb" },
        color: "INDIGO",
      }),
      categoryDto({
        id: "c-maintenance",
        groupId: "g-housing",
        name: "Mantenimiento",
        key: "maintenance",
        icon: { kind: "SYMBOL", name: "wrench" },
        color: "INDIGO",
      }),
    ],
  }),
  groupDto({
    id: "g-income",
    name: "Ingresos",
    key: "income",
    icon: { kind: "SYMBOL", name: "coins" },
    color: "PINE",
  }),
];

const sub = (id: string, name: string, overrides: Partial<Node> = {}): Node =>
  categoryDto({
    id,
    name,
    parentCategoryId: "c-groceries",
    icon: { kind: "SYMBOL", name: "cart" },
    color: "SAND",
    ...overrides,
  });

/** Household's Food group: "Groceries" shows the symbol "cart" in "SAND". */
const household = (groceries: Partial<Node> = {}): CategoryGroupDto[] => [
  groupDto({
    id: "g-food",
    name: "Food",
    icon: { kind: "SYMBOL", name: "apple" },
    color: "SAND",
    categories: [
      categoryDto({
        id: "c-groceries",
        name: "Groceries",
        icon: { kind: "SYMBOL", name: "cart" },
        color: "SAND",
        ...groceries,
      }),
      categoryDto({
        id: "c-dining",
        name: "Restaurants",
        icon: { kind: "SYMBOL", name: "fork" },
        color: "SAND",
      }),
    ],
  }),
  groupDto({
    id: "g-income",
    name: "Income",
    key: "income",
    categories: [categoryDto({ id: "c-salary", groupId: "g-income", name: "Wages" })],
  }),
];

const renderTree = (
  groups: readonly CategoryGroupDto[],
  { space = householdSpace(), routes = {} }: { space?: SpaceDto; routes?: Record<string, FakeHandler> } = {},
) => {
  const { api, requests } = fakeApi(routes);
  const view = renderWithIntl(<CategoryTree space={space} groups={groups} api={api} />);
  return { ...view, requests };
};

const group = (name: string) => screen.getByRole("region", { name });
const namesIn = (region: HTMLElement) =>
  within(region)
    .getAllByRole("button", { name: /^Editar / })
    .map((button) => button.getAttribute("aria-label")!.replace("Editar ", ""));
const glyphOf = (button: HTMLElement) =>
  button.closest("li")!.querySelector<HTMLElement>("[aria-hidden='true']")!;
const bodyOf = async (request: Request) => (await request.clone().json()) as Record<string, unknown>;

/** What the API answers to a create: the request's fields over a live category. */
const created =
  (id: string): FakeHandler =>
  async (request) => {
    const body = await request.clone().json();
    return jsonResponse(
      categoryDto({
        id,
        groupId: body.groupId ?? "g-food",
        parentCategoryId: body.parentCategoryId ?? null,
        name: body.name,
        icon: body.icon ?? { kind: "SYMBOL", name: "cart" },
        color: body.color ?? "SAND",
      }),
      201,
    );
  };

describe("categories screen (HU-E9-04)", () => {
  it("shows the seeded tree as stored, its group lists Arriendo, Servicios and Mantenimiento", async () => {
    const { container } = renderTree(SEEDED, { space: spaceDto() });
    expect(screen.getByRole("heading", { level: 1, name: "Categorías" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal");
    expect(namesIn(group("Vivienda"))).toEqual(["Arriendo", "Servicios", "Mantenimiento"]);
    // The income group is on the Ingresos tab (issue #173), not the Gastos one.
    expect(screen.queryByRole("region", { name: "Ingresos" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: "Ingresos" }));
    expect(group("Ingresos")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Vivienda" })).not.toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("creates a group, a category and a subcategory without a reload, and offers no level below a subcategory", async () => {
    const { requests } = renderTree(household(), {
      routes: {
        "POST /api/v1/spaces/{spaceId}/category-groups": async (request) => {
          const body = await request.clone().json();
          return jsonResponse({ id: "g-pets", key: null, archivedAt: null, ...body }, 201);
        },
        "POST /api/v1/spaces/{spaceId}/categories": async (request) => {
          const body = await request.clone().json();
          return created(body.parentCategoryId ? "c-veg" : "c-bakery")(request, {});
        },
      },
    });

    await userEvent.click(screen.getByRole("button", { name: "Nuevo grupo" }));
    const newGroup = await screen.findByRole("dialog", { name: "Nuevo grupo" });
    await userEvent.type(within(newGroup).getByLabelText("Nombre"), "Pets");
    await userEvent.click(within(newGroup).getByRole("button", { name: "Ver todos" }));
    const library = await screen.findByRole("dialog", { name: "Biblioteca de íconos" });
    await userEvent.click(within(library).getByRole("button", { name: "Mascotas" }));
    expect(screen.queryByRole("dialog", { name: "Biblioteca de íconos" })).not.toBeInTheDocument();
    // "paw" is outside the quick set, so it takes the first slot, chosen.
    expect(within(newGroup).getByRole("radio", { name: "Mascotas" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(within(newGroup).getByRole("radio", { name: "Oliva" }));
    expect(await axeViolations(newGroup)).toEqual([]);
    await userEvent.click(within(newGroup).getByRole("button", { name: "Crear grupo" }));
    expect(await bodyOf(requests.at(-1)!)).toEqual({
      name: "Pets",
      icon: { kind: "SYMBOL", name: "paw" },
      color: "OLIVE",
    });
    await waitFor(() => expect(group("Pets")).toBeInTheDocument());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Agregar categoría a Food" }));
    const newCategory = await screen.findByRole("dialog", { name: "Nueva categoría en Food" });
    await userEvent.type(within(newCategory).getByLabelText("Nombre"), "Bakery");
    await userEvent.click(within(newCategory).getByRole("button", { name: "Crear categoría" }));
    await waitFor(() => expect(namesIn(group("Food"))).toEqual(["Groceries", "Restaurants", "Bakery"]));

    await userEvent.click(screen.getByRole("button", { name: "Editar Groceries" }));
    const edit = await screen.findByRole("dialog", { name: "Editar Groceries" });
    await userEvent.type(within(edit).getByLabelText("Nueva subcategoría"), "Vegetables");
    await userEvent.click(within(edit).getByRole("button", { name: "Agregar subcategoría" }));
    expect(await bodyOf(requests.at(-1)!)).toEqual({ parentCategoryId: "c-groceries", name: "Vegetables" });
    await waitFor(() => expect(within(edit).getByRole("listitem")).toHaveTextContent("Vegetables"));
    await userEvent.click(within(edit).getByRole("button", { name: "Cerrar" }));

    await userEvent.click(screen.getByRole("button", { name: "Subcategorías de Groceries" }));
    const nested = screen.getByRole("list", { name: "Subcategorías de Groceries" });
    expect(within(nested).getByRole("button", { name: "Editar Vegetables" })).toBeInTheDocument();
    await userEvent.click(within(nested).getByRole("button", { name: "Editar Vegetables" }));
    const vegetables = await screen.findByRole("dialog", { name: "Editar Vegetables" });
    expect(
      within(vegetables).queryByRole("button", { name: "Agregar subcategoría" }),
    ).not.toBeInTheDocument();
    expect(within(vegetables).queryByLabelText("Nueva subcategoría")).not.toBeInTheDocument();
    // A subcategory shows its parent's style: no icon picker, no color row, no group choice.
    expect(within(vegetables).queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(
      within(vegetables).getByText("Una subcategoría muestra el ícono y el color de Groceries."),
    ).toBeInTheDocument();
    expect(await axeViolations(vegetables)).toEqual([]);
  });

  it("changes a category's icon, color and group, and its subcategories move and restyle with it", async () => {
    const { requests } = renderTree(
      household({ subcategories: [sub("c-veg", "Vegetables"), sub("c-meat", "Meat")] }),
      {
        routes: {
          "POST /api/v1/spaces/{spaceId}/category-groups": () =>
            jsonResponse(
              groupDto({
                id: "g-pantry",
                name: "Pantry",
                key: null,
                icon: { kind: "SYMBOL", name: "tag" },
                color: "GRAPHITE",
              }),
              201,
            ),
          "PATCH /api/v1/spaces/{spaceId}/categories/{categoryId}": async (request) => {
            const body = await request.clone().json();
            return jsonResponse(
              categoryDto({
                id: "c-groceries",
                name: "Groceries",
                groupId: body.groupId,
                icon: body.icon,
                color: body.color,
              }),
            );
          },
        },
      },
    );

    await userEvent.click(screen.getByRole("button", { name: "Editar Groceries" }));
    const edit = await screen.findByRole("dialog", { name: "Editar Groceries" });
    const quick = within(edit).getByRole("radiogroup", { name: "Íconos" });
    expect(within(quick).getAllByRole("radio")).toHaveLength(11);
    expect(within(quick).getByRole("radio", { name: "Carrito" })).toHaveAttribute("aria-checked", "true");
    expect(within(edit).getByRole("button", { name: "Ver todos" })).toBeInTheDocument();
    expect(
      within(within(edit).getByRole("radiogroup", { name: "Color" })).getAllByRole("radio"),
    ).toHaveLength(16);
    expect(within(edit).getByRole("radio", { name: "Arena" })).toHaveAttribute("aria-checked", "true");
    expect(await axeViolations(edit)).toEqual([]);

    await userEvent.click(within(edit).getByRole("button", { name: "Ver todos" }));
    const library = await screen.findByRole("dialog", { name: "Biblioteca de íconos" });
    await userEvent.click(within(library).getByRole("radio", { name: "Emoji" }));
    await userEvent.type(within(library).getByLabelText("Buscar ícono"), "CARRITO");
    expect(within(library).getAllByRole("button", { name: /Carrito/ })).toHaveLength(1);
    expect(await axeViolations(library)).toEqual([]);
    await userEvent.click(within(library).getByRole("button", { name: "Carrito de compras" }));
    expect(within(edit).getByRole("radio", { name: "Emoji" })).toHaveAttribute("aria-checked", "true");
    expect(within(edit).getByRole("radio", { name: "Carrito de compras" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await userEvent.click(within(edit).getByRole("radio", { name: "Ciruela" }));
    await userEvent.click(within(edit).getByRole("button", { name: "Nuevo grupo" }));
    const newGroup = await screen.findByRole("dialog", { name: "Nuevo grupo" });
    await userEvent.type(within(newGroup).getByLabelText("Nombre"), "Pantry");
    await userEvent.click(within(newGroup).getByRole("button", { name: "Crear grupo" }));
    // Back in the category form, with the new group chosen and the draft kept.
    await waitFor(() =>
      expect(within(edit).getByRole("radio", { name: "Pantry" })).toHaveAttribute("aria-checked", "true"),
    );
    expect(within(edit).getByRole("radio", { name: "Ciruela" })).toHaveAttribute("aria-checked", "true");
    expect(within(edit).getByRole("radio", { name: "Carrito de compras" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    await userEvent.click(within(edit).getByRole("button", { name: "Guardar cambios" }));
    expect(await bodyOf(requests.at(-1)!)).toEqual({
      groupId: "g-pantry",
      icon: { kind: "EMOJI", value: "🛒" },
      color: "PLUM",
    });
    await waitFor(() => expect(namesIn(group("Pantry"))).toEqual(["Groceries"]));
    expect(namesIn(group("Food"))).toEqual(["Restaurants"]);
    const groceries = within(group("Pantry")).getByRole("button", { name: "Editar Groceries" });
    expect(groceries).toHaveTextContent("2 subcategorías");
    expect(glyphOf(groceries)).toHaveTextContent("🛒");
    expect(glyphOf(groceries).style.getPropertyValue("--tint")).toBe("var(--pal-plum-tint)");
    await userEvent.click(screen.getByRole("button", { name: "Subcategorías de Groceries" }));
    for (const name of ["Vegetables", "Meat"]) {
      const row = screen.getByRole("button", { name: `Editar ${name}` });
      expect(glyphOf(row)).toHaveTextContent("🛒");
      expect(glyphOf(row).style.getPropertyValue("--tint")).toBe("var(--pal-plum-tint)");
    }
  });

  it("keeps the library choice-free when it is closed, and says when a search matches nothing", async () => {
    renderTree(household());
    await userEvent.click(screen.getByRole("button", { name: "Editar Groceries" }));
    const edit = await screen.findByRole("dialog", { name: "Editar Groceries" });
    await userEvent.clear(within(edit).getByLabelText("Nombre"));
    // A name is required: an emptied one cannot be saved, even with another change.
    await userEvent.click(within(edit).getByRole("radio", { name: "Ciruela" }));
    expect(within(edit).getByRole("button", { name: "Guardar cambios" })).toBeDisabled();
    await userEvent.click(within(edit).getByRole("radio", { name: "Arena" }));
    await userEvent.type(within(edit).getByLabelText("Nombre"), "Mercado");
    await userEvent.click(within(edit).getByRole("button", { name: "Ver todos" }));
    const library = await screen.findByRole("dialog", { name: "Biblioteca de íconos" });
    // A section's name matches every choice in it.
    await userEvent.type(within(library).getByLabelText("Buscar ícono"), "transporte");
    expect(within(library).getByRole("heading", { name: "Transporte" })).toBeInTheDocument();
    expect(within(library).getAllByRole("button", { pressed: false })).toHaveLength(7);
    await userEvent.clear(within(library).getByLabelText("Buscar ícono"));
    await userEvent.type(within(library).getByLabelText("Buscar ícono"), "zzz");
    expect(within(library).getByRole("status")).toHaveTextContent("No hay ningún ícono «zzz».");
    await userEvent.click(within(library).getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog", { name: "Biblioteca de íconos" })).not.toBeInTheDocument();
    expect(within(edit).getByRole("radio", { name: "Carrito" })).toHaveAttribute("aria-checked", "true");
    expect(within(edit).getByLabelText("Nombre")).toHaveValue("Mercado");
  });

  it("offers Archive instead when a referenced category is deleted, and moves it to the archived section", async () => {
    const { requests } = renderTree(household({ subcategories: [sub("c-veg", "Vegetables")] }), {
      routes: {
        "DELETE /api/v1/spaces/{spaceId}/categories/{categoryId}": () =>
          problemResponse(409, "CategoryInUse"),
        "POST /api/v1/spaces/{spaceId}/categories/{categoryId}/archive": () =>
          jsonResponse(
            categoryDto({ id: "c-groceries", name: "Groceries", archivedAt: "2026-10-26T15:00:00.000Z" }),
          ),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Editar Groceries" }));
    const edit = await screen.findByRole("dialog", { name: "Editar Groceries" });
    await userEvent.click(within(edit).getByRole("button", { name: "Archivar" }));
    expect(within(edit).getByText(/Sus subcategorías también se archivan\./)).toBeInTheDocument();
    await userEvent.click(within(edit).getByRole("button", { name: "Cancelar" }));
    await userEvent.click(within(edit).getByRole("button", { name: "Eliminar" }));
    expect(within(edit).getByText("¿Eliminar Groceries? No se puede deshacer.")).toBeInTheDocument();
    await userEvent.click(within(edit).getByRole("button", { name: "Eliminar" }));
    expect(await within(edit).findByRole("alert")).toHaveTextContent(
      "Esta categoría tiene subcategorías o movimientos. Archívala en lugar de borrarla.",
    );
    expect(await axeViolations(edit)).toEqual([]);
    await userEvent.click(within(edit).getByRole("button", { name: "Archivar en su lugar" }));
    expect(requests.at(-1)!.url).toMatch(/\/categories\/c-groceries\/archive$/);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(namesIn(group("Food"))).toEqual(["Restaurants"]);
    const archived = group("Archivadas");
    expect(within(archived).getByText("Groceries")).toBeInTheDocument();
    // Archiving a category archives its subcategories too.
    expect(within(archived).getByText("Groceries › Vegetables")).toBeInTheDocument();
  });

  it("restores an archived category from the archived section, and shows why a subcategory cannot be", async () => {
    const archivedAt = "2026-10-20T15:00:00.000Z";
    const { container } = renderTree(
      household({ archivedAt, subcategories: [sub("c-veg", "Vegetables", { archivedAt })] }),
      {
        routes: {
          "POST /api/v1/spaces/{spaceId}/categories/{categoryId}/restore": (_request, { categoryId }) =>
            categoryId === "c-veg"
              ? problemResponse(409, "ParentCategoryArchived")
              : jsonResponse(categoryDto({ id: "c-groceries", name: "Groceries" })),
        },
      },
    );
    expect(namesIn(group("Food"))).toEqual(["Restaurants"]);
    expect(await axeViolations(container)).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Restaurar Groceries › Vegetables" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/archivada/i);
    await userEvent.click(screen.getByRole("button", { name: "Restaurar Groceries" }));
    await waitFor(() => expect(namesIn(group("Food"))).toEqual(["Groceries", "Restaurants"]));
    expect(within(group("Archivadas")).queryByText("Groceries")).not.toBeInTheDocument();
  });

  it("shows a VIEWER the tree read-only: no create, edit, move, archive, restore or delete control", async () => {
    const { container } = renderTree(
      household({
        subcategories: [sub("c-veg", "Vegetables")],
      }).concat(),
      { space: householdSpace({ role: "VIEWER" }) },
    );
    expect(
      screen.getByText(
        "Puedes ver las categorías de Household; solo sus propietarios y administradores las cambian.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo grupo" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Subcategorías de Groceries" }));
    expect(within(group("Food")).getByText("Vegetables")).toBeInTheDocument();
    // The only buttons left open and close subcategories.
    for (const button of screen.getAllByRole("button"))
      expect(button).toHaveAccessibleName(/^Subcategorías de /);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows a VIEWER the archived section without a restore control", () => {
    renderTree(household({ archivedAt: "2026-10-20T15:00:00.000Z" }), {
      space: householdSpace({ role: "VIEWER" }),
    });
    expect(within(group("Archivadas")).getByText("Groceries")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Restaurar/ })).not.toBeInTheDocument();
  });
});

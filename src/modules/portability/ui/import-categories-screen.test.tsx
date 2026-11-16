import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import type { CategoryGroupDto } from "@/shared/ui/api/dto";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { ImportPreviewDto } from "./dto";
import { ImportCategoriesScreen } from "./import-categories-screen";
import { previewFixture } from "./preview-fixture";

const ADJUST = "PATCH /api/v1/spaces/{spaceId}/imports/{importId}";
const REVIEW = "/spaces/sp-personal/data/imports/imp-1";
const GROUPS = [
  groupDto({
    id: "grp-alim",
    name: "Alimentación",
    key: "food",
    categories: [
      {
        ...categoryDto({ id: "cat-mercado", groupId: "grp-alim", name: "Mercado" }),
        subcategories: [
          categoryDto({
            id: "cat-dom",
            groupId: "grp-alim",
            parentCategoryId: "cat-mercado",
            name: "Domicilios",
          }),
        ],
      },
      categoryDto({ id: "cat-rest", groupId: "grp-alim", name: "Restaurantes" }),
    ],
  }),
  groupDto({
    id: "grp-ingresos",
    name: "Ingresos",
    key: "income",
    categories: [categoryDto({ id: "cat-salario", groupId: "grp-ingresos", name: "Salario" })],
  }),
  groupDto({ id: "grp-otros", name: "Otros", key: "other" }),
];

const renderCategories = ({
  routes = {},
  locale = "es",
  preview = previewFixture(),
  groups = GROUPS,
}: {
  routes?: Record<string, FakeHandler>;
  locale?: "es" | "en";
  preview?: ImportPreviewDto;
  groups?: readonly CategoryGroupDto[];
} = {}) => {
  const { api } = fakeApi(routes);
  const onAdjusted = vi.fn();
  const view = renderWithIntl(
    <ImportCategoriesScreen
      backHref={REVIEW}
      preview={preview}
      groups={groups}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      draft={{ spaceId: "sp-personal", importId: "imp-1", onAdjusted, api }}
    />,
    { locale },
  );
  return { ...view, onAdjusted };
};

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });
const recording = (bodies: unknown[]): Record<string, FakeHandler> => ({
  [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(previewFixture())),
});

/** A preview whose one category maps as `mapping` says. */
const withMapping = (sourceId: string, mapping: ImportPreviewDto["categories"][number]["mapping"]) =>
  previewFixture({
    categories: previewFixture().categories.map((c) => (c.sourceId === sourceId ? { ...c, mapping } : c)),
  });

describe("Categorías a importar (D28, board 5)", () => {
  it("lists the file's categories by kind, each with what it goes to", async () => {
    const { container } = renderCategories();
    expect(screen.getByRole("heading", { level: 1, name: "Categorías a importar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", REVIEW);
    const expenses = within(screen.getByRole("region", { name: "Gastos · 3" }));
    expect(expenses.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "🍜FoodAlimentación › Mercado",
      "DomicilioNueva subcategoría en Mercado",
      "🧺VariosNueva en Otros",
    ]);
    const income = within(screen.getByRole("region", { name: "Ingresos · 1" }));
    expect(income.getAllByRole("button").map((b) => b.textContent)).toEqual(["💰SalaryIngresos › Salario"]);
    // A subcategory sits under its category, indented.
    expect(row("Domicilio")).toHaveClass("pl-11");
    expect(screen.getByRole("link", { name: "Listo" })).toHaveAttribute("href", REVIEW);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("names a new category's group, the import's own by default, and the name the confirm will use", () => {
    renderCategories({
      preview: withMapping("c-misc", { kind: "new", groupId: null, name: "Varios (Money Manager)" }),
    });
    expect(row("Varios")).toHaveTextContent(
      "Nueva en Grupo de la importación, como «Varios (Money Manager)»",
    );
  });

  it("names a missing target as missing, and an archived one an undone import created as brought back", () => {
    const archived = GROUPS.map((g) =>
      g.id === "grp-ingresos"
        ? { ...g, categories: g.categories.map((c) => ({ ...c, archivedAt: "2026-11-15T16:00:00.000Z" })) }
        : g,
    );
    renderCategories({
      preview: withMapping("c-food", { kind: "existing", categoryId: "cat-gone" }),
      groups: archived,
    });
    expect(row("Food")).toHaveTextContent("La categoría elegida ya no está: elige otra");
    expect(row("Salary")).toHaveTextContent("Ingresos › Salario · se recupera");
  });

  it("offers a category of the file only categories, and keeps the name of a new one", async () => {
    const bodies: unknown[] = [];
    const { onAdjusted } = renderCategories({ routes: recording(bodies) });
    await userEvent.click(row("Varios"));
    const sheet = await screen.findByRole("dialog", { name: "Varios" });
    // Its subcategories go under whatever it goes to, so a subcategory (Mercado › Domicilios) is never offered.
    const choices = within(sheet).getByRole("radiogroup", { name: "Dónde va esta categoría" });
    expect(
      within(choices)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual([
      "Crear una categoría nueva",
      "Alimentación › Mercado",
      "Alimentación › Restaurantes",
      "Ingresos › Salario",
    ]);
    expect(within(sheet).getByRole("radio", { name: "Crear una categoría nueva" })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Otros" })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Alimentación" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledOnce());
    expect(bodies).toEqual([
      { categories: { "c-misc": { kind: "new", groupId: "grp-alim", name: "Varios" } } },
    ]);
  });

  it("puts a new category in the import's own group with a null group", async () => {
    const bodies: unknown[] = [];
    renderCategories({ routes: recording(bodies) });
    await userEvent.click(row("Varios"));
    const sheet = await screen.findByRole("dialog", { name: "Varios" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Grupo de la importación" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ categories: { "c-misc": { kind: "new", groupId: null, name: "Varios" } } }]),
    );
  });

  it("offers a subcategory only the subcategories of what its parent goes to", async () => {
    const bodies: unknown[] = [];
    renderCategories({ routes: recording(bodies) });
    await userEvent.click(row("Domicilio"));
    const sheet = await screen.findByRole("dialog", { name: "Domicilio" });
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Crear una subcategoría nueva en Mercado", "Mercado › Domicilios"]);
    expect(within(sheet).queryByRole("radiogroup", { name: "Grupo" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Mercado › Domicilios" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ categories: { "c-delivery": { kind: "existing", categoryId: "cat-dom" } } }]),
    );
  });

  it("offers a subcategory nothing to map to while its parent is new", async () => {
    renderCategories({ preview: withMapping("c-food", { kind: "new", groupId: null, name: "Food" }) });
    await userEvent.click(row("Domicilio"));
    const sheet = await screen.findByRole("dialog", { name: "Domicilio" });
    expect(
      within(sheet)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Crear una subcategoría nueva en Food"]);
  });

  it("keeps the sheet open with a refusal", async () => {
    const { onAdjusted } = renderCategories({
      routes: { [ADJUST]: () => problemResponse(409, "ImportSnapshotExpired") },
    });
    await userEvent.click(row("Food"));
    const sheet = await screen.findByRole("dialog", { name: "Food" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(es.errors.ImportSnapshotExpired);
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it("words the screen in English", () => {
    renderCategories({ locale: "en" });
    expect(screen.getByRole("heading", { level: 1, name: "Categories to import" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Expenses · 3" })).toBeVisible();
    expect(screen.getByText("New in Otros")).toBeVisible();
  });
});

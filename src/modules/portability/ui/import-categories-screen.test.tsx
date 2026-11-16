import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
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
      categoryDto({ id: "cat-mercado", groupId: "grp-alim", name: "Mercado" }),
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

const renderCategories = (routes: Record<string, FakeHandler> = {}, locale: "es" | "en" = "es") => {
  const { api } = fakeApi(routes);
  const onAdjusted = vi.fn();
  const view = renderWithIntl(
    <ImportCategoriesScreen
      backHref={REVIEW}
      preview={previewFixture()}
      groups={GROUPS}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      draft={{ spaceId: "sp-personal", importId: "imp-1", onAdjusted, api }}
    />,
    { locale },
  );
  return { ...view, onAdjusted };
};

const row = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

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

  it("moves a new category to another group", async () => {
    const bodies: unknown[] = [];
    const { onAdjusted } = renderCategories({
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(previewFixture())),
    });
    await userEvent.click(row("Varios"));
    const sheet = await screen.findByRole("dialog", { name: "Varios" });
    expect(within(sheet).getByRole("radio", { name: "Crear una categoría nueva" })).toBeChecked();
    expect(within(sheet).getByRole("radio", { name: "Otros" })).toBeChecked();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Alimentación" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledOnce());
    expect(bodies).toEqual([{ categories: { "c-misc": { kind: "new", groupId: "grp-alim" } } }]);
  });

  it("maps a subcategory to a category the space has", async () => {
    const bodies: unknown[] = [];
    renderCategories({
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(previewFixture())),
    });
    await userEvent.click(row("Domicilio"));
    const sheet = await screen.findByRole("dialog", { name: "Domicilio" });
    expect(
      within(sheet).getByRole("radio", { name: "Crear una subcategoría nueva en Mercado" }),
    ).toBeChecked();
    expect(within(sheet).queryByRole("radiogroup", { name: "Grupo" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Alimentación › Restaurantes" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { categories: { "c-delivery": { kind: "existing", categoryId: "cat-rest" } } },
      ]),
    );
  });

  it("keeps the sheet open with a refusal", async () => {
    const { onAdjusted } = renderCategories({
      [ADJUST]: () => problemResponse(409, "ImportSnapshotExpired"),
    });
    await userEvent.click(row("Food"));
    const sheet = await screen.findByRole("dialog", { name: "Food" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(es.errors.ImportSnapshotExpired);
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it("words the screen in English", () => {
    renderCategories({}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Categories to import" })).toBeVisible();
    expect(screen.getByRole("region", { name: "Expenses · 3" })).toBeVisible();
    expect(screen.getByText("New in Otros")).toBeVisible();
  });
});

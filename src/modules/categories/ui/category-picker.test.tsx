import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { categoryDto, groupDto } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { CategoryPicker } from "./category-picker";

const groceries = categoryDto({
  id: "c-groceries",
  name: "Groceries",
  subcategories: [
    categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" }),
    categoryDto({
      id: "c-old",
      name: "Old",
      parentCategoryId: "c-groceries",
      archivedAt: "2026-10-01T00:00:00.000Z",
    }),
  ],
});
const groups = [
  groupDto({
    id: "g-food",
    name: "Food",
    categories: [
      groceries,
      categoryDto({ id: "c-gone", name: "Gone", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ],
  }),
  groupDto({
    id: "g-closed",
    name: "Closed",
    archivedAt: "2026-10-01T00:00:00.000Z",
    categories: [categoryDto({ id: "c-x", name: "X" })],
  }),
];

describe("category picker (HU-E9-03)", () => {
  it("offers the subcategories as optional chips, none chosen by default", async () => {
    const onChoose = vi.fn();
    renderWithIntl(
      <CategoryPicker open onOpenChange={() => undefined} groups={groups} value={null} onChoose={onChoose} />,
    );
    const sheet = screen.getByRole("dialog", { name: "Categoría" });
    expect(within(sheet).queryByText("Gone")).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Groceries" }));
    const subs = within(sheet).getByRole("radiogroup", { name: "Subcategorías de Groceries" });
    expect(within(subs).getByRole("radio", { name: "Sin subcategoría" })).toBeChecked();
    expect(within(subs).getByRole("radio", { name: "Vegetables" })).toBeInTheDocument();
    expect(within(subs).queryByRole("radio", { name: "Old" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Usar Groceries" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-groceries", subcategoryId: null });
  });

  it("chooses a subcategory in the same sheet", async () => {
    const onChoose = vi.fn();
    renderWithIntl(
      <CategoryPicker open onOpenChange={() => undefined} groups={groups} value={null} onChoose={onChoose} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries › Vegetables" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-groceries", subcategoryId: "c-veg" });
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("chooses a category without subcategories at once and closes the sheet", async () => {
    const onChoose = vi.fn();
    const onOpenChange = vi.fn();
    const leafGroups = [groupDto({ categories: [categoryDto({ id: "c-rent", name: "Rent" })] })];
    renderWithIntl(
      <CategoryPicker
        open
        onOpenChange={onOpenChange}
        groups={leafGroups}
        value={{ categoryId: "c-rent", subcategoryId: null }}
        onChoose={onChoose}
      />,
    );
    expect(screen.queryByRole("radiogroup", { name: "Subcategorías de Rent" })).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Rent" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-rent", subcategoryId: null });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("radiogroup", { name: "Subcategorías de Rent" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Usar/ })).toBeNull();
  });

  it("keeps the subcategory when its category is tapped again, lets none clear it and closes on confirm", async () => {
    const onChoose = vi.fn();
    const onOpenChange = vi.fn();
    renderWithIntl(
      <CategoryPicker open onOpenChange={onOpenChange} groups={groups} value={null} onChoose={onChoose} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    await userEvent.click(screen.getByRole("radio", { name: "Vegetables" }));
    await userEvent.click(screen.getByRole("radio", { name: "Groceries" }));
    expect(screen.getByRole("radio", { name: "Vegetables" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Sin subcategoría" }));
    await userEvent.click(screen.getByRole("button", { name: "Usar Groceries" }));
    expect(onChoose).toHaveBeenLastCalledWith({ categoryId: "c-groceries", subcategoryId: null });
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("filters by name and says when nothing matches", async () => {
    renderWithIntl(
      <CategoryPicker open onOpenChange={() => undefined} groups={groups} value={null} onChoose={vi.fn()} />,
    );
    await userEvent.type(screen.getByLabelText("Buscar categoría"), "pana");
    expect(screen.getByText("No hay ninguna categoría «pana».")).toBeInTheDocument();
  });
});

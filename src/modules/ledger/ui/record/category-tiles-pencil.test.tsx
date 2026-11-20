import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { activeTree } from "@/modules/categories/ui";
import { CategoryTiles } from "./category-tiles";

const groceries = categoryDto({ id: "c-groceries", groupId: "g-food", name: "Groceries" });
const old = categoryDto({ id: "c-old", groupId: "g-food", name: "Old", archivedAt: "2026-01-01T00:00:00Z" });
const groups = [groupDto({ id: "g-food", name: "Food", categories: [groceries, old] })];

const tiles = (categoryId: string) =>
  renderWithIntl(
    <CategoryTiles
      groups={groups}
      offered={activeTree(groups)}
      recent={[]}
      value={{ categoryId, subcategoryId: null }}
      onChoose={vi.fn()}
      onMore={vi.fn()}
      onEdit={vi.fn()}
    />,
  );

describe("the pencil edits only a live chosen category (P346, S6)", () => {
  it("shows the pencil for a live chosen category", () => {
    tiles("c-groceries");
    expect(screen.getByRole("button", { name: "Editar Groceries" })).toBeInTheDocument();
  });

  it("shows no pencil when an edited movement holds an archived or deleted category, which the editor cannot open", () => {
    tiles("c-old");
    expect(screen.getByRole("button", { name: "Old", pressed: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Old" })).toBeNull();
  });
});

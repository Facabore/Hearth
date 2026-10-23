import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { categoryDto, groupDto } from "../../../../../tests/support/ui/dto";
import { planLineDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { CategoryMappingSheet } from "./category-mapping-sheet";

const groups = [
  groupDto({
    id: "g-home",
    name: "Hogar",
    categories: [
      categoryDto({
        id: "c-groceries",
        name: "Groceries",
        subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
      }),
      categoryDto({ id: "c-utilities", name: "Utilities" }),
      categoryDto({ id: "c-rent", name: "Rent" }),
      categoryDto({ id: "c-old", name: "Old", archivedAt: "2026-10-01T00:00:00.000Z" }),
    ],
  }),
];
const plan = referencePlanDto({
  lines: [
    planLineDto({ id: "l-rent", name: "Rent", categoryIds: ["c-rent"] }),
    planLineDto({ categoryIds: ["c-groceries"] }),
  ],
});

describe("category mapping (HU-E9-08, ruling P212)", () => {
  it("offers live parent categories only, disables another line's and returns the chosen ones", async () => {
    const onChange = vi.fn();
    renderWithIntl(
      <CategoryMappingSheet
        open
        onOpenChange={() => undefined}
        groups={groups}
        plan={plan}
        lineId="l-home"
        lineName="Home"
        value={["c-groceries"]}
        onChange={onChange}
      />,
    );
    const sheet = await screen.findByRole("dialog", { name: "Categorías de Home" });
    expect(within(sheet).getByRole("checkbox", { name: "Groceries" })).toBeChecked();
    // The line's own categories stay editable: only another line's are taken.
    expect(within(sheet).getByRole("checkbox", { name: "Groceries" })).toBeEnabled();
    expect(within(sheet).queryByRole("checkbox", { name: "Vegetables" })).toBeNull();
    expect(within(sheet).queryByRole("checkbox", { name: "Old" })).toBeNull();
    const rent = within(sheet).getByRole("checkbox", { name: "Rent" });
    expect(rent).toBeDisabled();
    expect(rent).toHaveAccessibleDescription("En Rent");
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Utilities" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(onChange).toHaveBeenCalledWith(["c-groceries", "c-utilities"]);
    expect(await axeViolations(document.body)).toEqual([]);
  });

  it("filters by search, returns the chosen ones in the tree's order and leaves out one no longer offered", async () => {
    const onChange = vi.fn();
    renderWithIntl(
      <CategoryMappingSheet
        open
        onOpenChange={() => undefined}
        groups={groups}
        plan={plan}
        lineId="l-home"
        lineName="Home"
        value={["c-utilities", "c-gone"]}
        onChange={onChange}
      />,
    );
    const sheet = await screen.findByRole("dialog");
    await userEvent.type(within(sheet).getByRole("searchbox", { name: "Buscar categoría" }), "groc");
    expect(within(sheet).queryByRole("checkbox", { name: "Utilities" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("checkbox", { name: "Groceries" }));
    await userEvent.clear(within(sheet).getByRole("searchbox", { name: "Buscar categoría" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Listo" }));
    expect(onChange).toHaveBeenCalledWith(["c-groceries", "c-utilities"]);
  });

  it("starts from the line's categories and an empty search each time it opens", async () => {
    function Reopen() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button onClick={() => setOpen(true)}>Abrir</button>
          <CategoryMappingSheet
            open={open}
            onOpenChange={setOpen}
            groups={groups}
            plan={plan}
            lineId="l-home"
            lineName="Home"
            value={["c-utilities"]}
            onChange={() => undefined}
          />
        </>
      );
    }
    renderWithIntl(<Reopen />);
    const first = await screen.findByRole("dialog");
    await userEvent.click(within(first).getByRole("checkbox", { name: "Groceries" }));
    await userEvent.type(within(first).getByRole("searchbox"), "util");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Abrir" }));
    const again = await screen.findByRole("dialog");
    expect(within(again).getByRole("searchbox")).toHaveValue("");
    expect(within(again).getByRole("checkbox", { name: "Groceries" })).not.toBeChecked();
    expect(within(again).getByRole("checkbox", { name: "Utilities" })).toBeChecked();
  });
});

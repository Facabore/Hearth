import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { ImportCategoryGroupDto, ImportPreviewDto } from "./dto";
import { ImportCategoriesScreen } from "./import-categories-screen";
import { previewFixture } from "./preview-fixture";

/** The block that pins a screen's main action (#281): sticky at the bottom, the gutter's 16 px above its buttons. */
const expectPinned = (action: HTMLElement) => {
  const block = action.closest(".sticky");
  expect(block).toHaveClass("sticky", "bottom-0", "pt-4", "bg-bg");
};

const ADJUST = "PATCH /api/v1/spaces/{spaceId}/imports/{importId}";
const REVIEW = "/spaces/sp-personal/data/imports/imp-1";

const renderCategories = (
  preview: ImportPreviewDto = previewFixture(),
  routes: Record<string, FakeHandler> = {},
  locale: "es" | "en" = "es",
) => {
  const { api } = fakeApi(routes);
  const onAdjusted = vi.fn();
  const view = renderWithIntl(
    <ImportCategoriesScreen
      backHref={REVIEW}
      preview={preview}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      draft={{ spaceId: "sp-personal", importId: "imp-1", onAdjusted, api }}
    />,
    { locale },
  );
  return { ...view, onAdjusted };
};

/** Each group as the board lists it: its heading, then the line under it. */
const listed = () =>
  screen.getAllByRole("heading", { level: 3 }).map((h) => [h.textContent, h.nextElementSibling?.textContent]);

const SWITCH = "Archivar las de Hearth que no uses";

describe("Tus categorías (P337, board 4)", () => {
  it("lists each category as a group with its subcategories, in the file's order, read-only", async () => {
    const { container } = renderCategories();
    expect(screen.getByRole("heading", { level: 1, name: "Importar de Money Manager" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", REVIEW);
    expect(screen.getByRole("heading", { level: 2, name: "Tus categorías" })).toBeVisible();
    expect(
      screen.getByText(
        "Llegan como las tienes: cada categoría es un grupo, con sus subcategorías y en tu orden.",
      ),
    ).toBeVisible();
    expect(listed()).toEqual([
      ["Food · 2", "Lunch, Domicilio"],
      ["Pets", "Se elige directo, sin subcategorías"],
      ["Salary", "Se elige directo, sin subcategorías"],
    ]);
    // Nothing to change one by one: the only control is the switch.
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.getByRole("link", { name: "Continuar" })).toHaveAttribute("href", REVIEW);
    expectPinned(screen.getByRole("link", { name: "Continuar" }));
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows nine groups until the person asks for the rest", async () => {
    const group = (i: number): ImportCategoryGroupDto => ({
      name: `Grupo ${i}`,
      icon: null,
      target: "new",
      categories: [{ sourceId: `c-${i}`, name: `Grupo ${i}`, icon: null, target: "new" }],
    });
    const base = previewFixture();
    renderCategories(
      previewFixture({
        categories: { ...base.categories, groups: Array.from({ length: 17 }, (_, i) => group(i + 1)) },
      }),
    );
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(9);
    await userEvent.click(screen.getByRole("button", { name: "y 8 grupos más" }));
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(17);
  });

  it("names the seeded groups the switch archives, on by default, by its thumb and its state, not by color", () => {
    renderCategories();
    const toggle = screen.getByRole("switch", { name: SWITCH });
    expect(toggle).toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      "Vivienda, Alimentación… sin movimientos. Puedes restaurarlas.",
    );
    // A 44 px target.
    expect(toggle).toHaveClass("h-11", "w-12");
  });

  it("says when there is nothing of Hearth's to archive", () => {
    const base = previewFixture();
    renderCategories(
      previewFixture({ categories: { ...base.categories, unusedSeeded: { groups: [], categories: [] } } }),
    );
    expect(screen.getByRole("switch", { name: SWITCH })).toHaveAccessibleDescription(
      "Usas todas las de Hearth: no hay nada que archivar.",
    );
  });

  it("turns the switch off through the draft's adjust, and shows the new preview", async () => {
    const bodies: unknown[] = [];
    const base = previewFixture();
    const off = previewFixture({ categories: { ...base.categories, archiveUnusedCategories: false } });
    const { onAdjusted } = renderCategories(base, {
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(off)),
    });
    await userEvent.click(screen.getByRole("switch", { name: SWITCH }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledWith(off));
    expect(bodies).toEqual([{ archiveUnusedCategories: false }]);
  });

  it("shows the refusal when the draft is no longer one", async () => {
    renderCategories(previewFixture(), { [ADJUST]: () => problemResponse(409, "ImportNotDraft") });
    await userEvent.click(screen.getByRole("switch", { name: SWITCH }));
    expect(await screen.findByRole("alert")).toHaveTextContent(es.errors.ImportNotDraft);
  });

  it("words the screen in English", () => {
    renderCategories(previewFixture(), {}, "en");
    expect(screen.getByRole("heading", { level: 2, name: "Your categories" })).toBeVisible();
    expect(listed()[1]).toEqual(["Pets", "Picked directly, no subcategories"]);
    expect(screen.getByRole("switch", { name: "Archive the Hearth ones you don't use" })).toBeChecked();
  });
});

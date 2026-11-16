import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { normalized } from "../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, type FakeHandler } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { ImportCountsDto, ImportPreviewDto } from "./dto";
import { ImportDoneScreen } from "./import-done-screen";
import { previewFixture, resultFixture } from "./preview-fixture";

const PLACE = {
  hubHref: "/spaces/sp-personal/data",
  transactionsHref: "/spaces/sp-personal/transactions",
  accountsHref: "/spaces/sp-personal/accounts",
  categoriesHref: "/spaces/sp-personal/categories",
  personal: { id: "sp-personal", name: "Personal" },
  importId: "imp-1",
};

const renderDone = ({
  counts = resultFixture().counts,
  preview = previewFixture(),
  undoable = true,
  routes = {},
  locale = "es",
}: {
  counts?: ImportCountsDto | null;
  preview?: ImportPreviewDto | null;
  undoable?: boolean;
  routes?: Record<string, FakeHandler>;
  locale?: "es" | "en";
} = {}) => {
  const { api } = fakeApi(routes);
  const onUndone = vi.fn();
  const view = renderWithIntl(
    <ImportDoneScreen
      place={PLACE}
      counts={counts}
      preview={preview}
      undoable={undoable}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      today="2026-11-16"
      onUndone={onUndone}
      api={api}
    />,
    { locale },
  );
  return { ...view, onUndone };
};

describe("Importación lista (D28, board 6)", () => {
  it("says what the import did, with the way to the movements and to undo it", async () => {
    const { container } = renderDone();
    expect(screen.getByRole("heading", { level: 1, name: "Importación lista" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", PLACE.hubHref);
    expect(screen.getByRole("heading", { level: 2, name: "Importamos 1.237 movimientos" })).toBeVisible();
    expect(normalized(screen.getByText(/, en Personal\.$/).textContent)).toBe(
      "Del 6 may 2025 al 13 nov, en Personal.",
    );
    expect(
      // The new accounts under the names the confirm gave them.
      screen.getByRole("link", { name: /2 cuentas nuevas.*Visa Oro y Cuenta en dólares \(Money Manager\)/ }),
    ).toHaveAttribute("href", PLACE.accountsHref);
    expect(screen.getByRole("link", { name: /2 categorías nuevas/ })).toHaveAttribute(
      "href",
      PLACE.categoriesHref,
    );
    expect(screen.getByText("3 parecidos que dejaste fuera")).toBeVisible();
    expect(screen.getByRole("link", { name: "Ver movimientos" })).toHaveAttribute(
      "href",
      PLACE.transactionsHref,
    );
    expect(screen.getByRole("button", { name: "Deshacer importación" })).toBeVisible();
    // The visual pass at 320 px: the gutter's 16 px between the rows scrolling behind and the buttons.
    expect(screen.getByRole("link", { name: "Ver movimientos" }).closest(".sticky")).toHaveClass(
      "bottom-0",
      "pt-4",
    );
    // A row that warns leads with the caution tone, as the review's card.
    const warn = screen
      .getByText("3 parecidos que dejaste fuera")
      .closest("div")!
      .querySelector<HTMLElement>("[aria-hidden=true]");
    expect(warn).toHaveClass("bg-[var(--pal-mustard-tint)]", "text-[var(--pal-mustard-ink)]");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("has the counts alone on a later visit, and names the rows the ledger refused", () => {
    renderDone({ preview: null, counts: { ...resultFixture().counts!, rowErrors: 2, duplicatesSkipped: 0 } });
    expect(screen.getByText("En Personal.")).toBeVisible();
    expect(screen.getByText("2 movimientos no se importaron")).toBeVisible();
    expect(screen.queryByText(/parecidos/)).toBeNull();
    expect(screen.getByRole("link", { name: /^2 cuentas nuevas$/ })).toBeVisible();
  });

  it("names the accounts and categories brought back from an undone import", () => {
    renderDone({ counts: { ...resultFixture().counts!, accountsRestored: 1, categoriesRestored: 3 } });
    expect(screen.getByRole("link", { name: /^1 cuenta recuperada/ })).toHaveAttribute(
      "href",
      PLACE.accountsHref,
    );
    expect(screen.getByRole("link", { name: /^3 categorías recuperadas/ })).toHaveAttribute(
      "href",
      PLACE.categoriesHref,
    );
    expect(screen.getAllByText("Las había archivado una importación que deshiciste")).toHaveLength(2);
  });

  it("counts a refused balance adjustment once, among the rows the ledger refused (#329)", () => {
    renderDone({ counts: { ...resultFixture().counts!, rowErrors: 1, adjustmentsNotImported: 1 } });
    expect(screen.getByText("1 movimiento no se importó")).toBeVisible();
    expect(screen.queryByText(/ajuste de saldo/)).toBeNull();
  });

  it("offers no undo for an import already undone", () => {
    renderDone({ undoable: false });
    expect(screen.queryByRole("button", { name: "Deshacer importación" })).toBeNull();
    expect(screen.queryByText(/¿Algo salió mal\?/)).toBeNull();
  });

  it("undoes the import after its confirmation", async () => {
    const { onUndone } = renderDone({
      routes: {
        "POST /api/v1/spaces/{spaceId}/imports/{importId}/undo": () =>
          jsonResponse({
            id: "imp-1",
            status: "UNDONE",
            movementsDeleted: 1237,
            accountsArchived: 2,
            categoriesArchived: 2,
          }),
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Deshacer importación" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Deshacer esta importación?" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Deshacer importación" }));
    await waitFor(() => expect(onUndone).toHaveBeenCalledOnce());
  });

  it("words the screen in English", () => {
    renderDone({ locale: "en" });
    expect(screen.getByRole("heading", { level: 2, name: "We imported 1.237 movements" })).toBeVisible();
    expect(screen.getByRole("link", { name: "See movements" })).toBeVisible();
  });
});

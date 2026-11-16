import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { normalized } from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { ImportSummaryDto } from "./dto";
import { ImportHubScreen } from "./import-hub-screen";
import { summaryFixture } from "./preview-fixture";

const PLACE = {
  backHref: "/spaces/sp-household/more",
  base: "/spaces/sp-household/data",
  personal: { id: "sp-personal", name: "Personal" },
};
const FORMATS = { numberFormat: "DOT_COMMA", dateFormat: "DMY" } as const;

const renderHub = (
  history: readonly ImportSummaryDto[] = [summaryFixture()],
  routes: Record<string, FakeHandler> = {},
  locale: "es" | "en" = "es",
) => {
  const { api, requests } = fakeApi(routes);
  const onUndone = vi.fn();
  const view = renderWithIntl(
    <ImportHubScreen
      place={PLACE}
      history={history}
      formats={FORMATS}
      today="2026-11-16"
      timeZone="America/Bogota"
      onUndone={onUndone}
      api={api}
    />,
    { locale },
  );
  return { ...view, onUndone, requests };
};

describe("Importar y exportar (D28, board 1)", () => {
  it("lists the sources, the download and the past imports, with Volver to Más", async () => {
    const { container } = renderHub();
    expect(screen.getByRole("heading", { level: 1, name: "Importar y exportar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household/more");
    expect(
      screen.getByRole("link", { name: /Money Manager.*Copia de seguridad de Android o iPhone/ }),
    ).toHaveAttribute("href", "/spaces/sp-household/data/money-manager");
    // A CSV file and Splitwise are still to come: muted, and they open nothing.
    for (const name of ["Archivo CSV", "Splitwise"]) {
      expect(screen.getByText(name)).toHaveClass("text-muted");
      expect(screen.getByText(name).closest("a, button")).toBeNull();
    }
    expect(screen.getByRole("link", { name: /Descargar mis datos/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household/data/export",
    );
    const history = within(screen.getByRole("region", { name: "Importaciones anteriores" }));
    expect(normalized(history.getByText(/Money Manager ·/).textContent)).toBe("Money Manager · 15 nov");
    expect(normalized(history.getByText(/movimientos · en/).textContent)).toBe(
      "1.237 movimientos · en Personal",
    );
    expect(history.getByRole("button", { name: /^Deshacer: Money Manager · 15.nov$/ })).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says when there is nothing imported yet", () => {
    renderHub([]);
    expect(screen.getByText("Aún no has importado nada.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Deshacer/ })).toBeNull();
  });

  it("opens a draft's review, and shows an undone import without its undo", () => {
    renderHub([
      summaryFixture({ id: "imp-2", status: "DRAFT", confirmedAt: null, counts: null }),
      summaryFixture({ id: "imp-1", status: "UNDONE", undoneAt: "2026-11-15T16:00:00.000Z" }),
    ]);
    expect(screen.getByRole("link", { name: /Sin confirmar: tócala para revisarla/ })).toHaveAttribute(
      "href",
      "/spaces/sp-household/data/imports/imp-2",
    );
    expect(screen.getByText("Deshecha")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Deshacer/ })).toBeNull();
  });

  it("undoes a confirmed import of the personal space only after its confirmation", async () => {
    const undone: string[] = [];
    const { onUndone } = renderHub([summaryFixture()], {
      "POST /api/v1/spaces/{spaceId}/imports/{importId}/undo": (_request, params) => {
        undone.push(`${params.spaceId}/${params.importId}`);
        return jsonResponse({
          id: "imp-1",
          status: "UNDONE",
          movementsDeleted: 1237,
          accountsArchived: 2,
          categoriesArchived: 2,
        });
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /Deshacer: / }));
    const sheet = await screen.findByRole("dialog", { name: "¿Deshacer esta importación?" });
    expect(undone).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Deshacer importación" }));
    await waitFor(() => expect(onUndone).toHaveBeenCalledOnce());
    expect(undone).toEqual(["sp-personal/imp-1"]);
  });

  it("keeps the sheet open with the API's reason when the undo is refused", async () => {
    const { onUndone } = renderHub([summaryFixture()], {
      "POST /api/v1/spaces/{spaceId}/imports/{importId}/undo": () => problemResponse(409, "PeriodClosed"),
    });
    await userEvent.click(screen.getByRole("button", { name: /Deshacer: / }));
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Deshacer importación" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      es.errors.PeriodClosed.split("{")[0]!.trim(),
    );
    expect(onUndone).not.toHaveBeenCalled();
  });

  it("forgets a refused undo once the sheet is cancelled, so the next one opens clean", async () => {
    renderHub([summaryFixture(), summaryFixture({ id: "imp-2" })], {
      "POST /api/v1/spaces/{spaceId}/imports/{importId}/undo": () => problemResponse(409, "PeriodClosed"),
    });
    const [first, second] = screen.getAllByRole("button", { name: /^Deshacer: / });
    await userEvent.click(first!);
    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: "Deshacer importación" }));
    expect(await within(sheet).findByRole("alert")).toBeVisible();
    await userEvent.click(within(sheet).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await userEvent.click(second!);
    const next = await screen.findByRole("dialog");
    expect(within(next).queryByRole("alert")).toBeNull();
  });

  it("words the hub in English", () => {
    renderHub([summaryFixture()], {}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Import and export" })).toBeVisible();
    expect(screen.getAllByText("Coming soon")).toHaveLength(2);
    expect(normalized(screen.getByText(/movements · in/).textContent)).toBe("1.237 movements · in Personal");
  });
});

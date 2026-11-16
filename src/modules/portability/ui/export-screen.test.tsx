import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { householdSpace, spaceDto } from "../../../../tests/support/ui/dto";
import { fakeApi, problemResponse, type FakeHandler } from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { ExportScreen, fileNameOf, REVOKE_AFTER_MS, saveFile } from "./export-screen";

const EXPORT = "GET /api/v1/me/export";
const SPACES = [spaceDto(), householdSpace({ name: "Hogar" })];

const renderExport = (routes: Record<string, FakeHandler> = {}, locale: "es" | "en" = "es") => {
  const { api, requests } = fakeApi(routes);
  const view = renderWithIntl(
    <ToastProvider>
      <ExportScreen backHref="/spaces/sp-personal/data" spaces={SPACES} api={api} />
    </ToastProvider>,
    { locale },
  );
  return { ...view, requests };
};

const zip = () =>
  new Response(new Blob(["PK"]), {
    headers: {
      "content-type": "application/zip",
      "content-disposition": 'attachment; filename="hearth-export-2026-11-16.zip"',
    },
  });

/** What the page saved: each temporary link's name and the object URL it pointed at. */
let saved: { name: string; href: string }[] = [];
beforeEach(() => {
  saved = [];
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() }),
  );
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ name: this.download, href: this.href });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Descargar mis datos (D28, board 7)", () => {
  it("offers JSON or CSV, all spaces or one, and says what the file holds and never does", async () => {
    const { container } = renderExport();
    expect(screen.getByRole("heading", { level: 1, name: "Descargar mis datos" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal/data");
    const format = screen.getByRole("radiogroup", { name: "Formato" });
    expect(within(format).getByRole("radio", { name: "JSON" })).toBeChecked();
    const scope = screen.getByRole("radiogroup", { name: "Qué incluir" });
    expect(within(scope).getByRole("radio", { name: /Todos mis espacios/ })).toHaveTextContent(
      "Todos mis espaciosPersonal y Hogar",
    );
    expect(screen.getByText(/Las cuentas personales de otros miembros nunca salen/)).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("downloads the whole export as JSON by default, under the name the API gives", async () => {
    const asked: string[] = [];
    renderExport({
      [EXPORT]: (request) => {
        asked.push(new URL(request.url).search);
        return new Response("{}", {
          headers: {
            "content-type": "application/json",
            "content-disposition": 'attachment; filename="hearth-export-2026-11-16.json"',
          },
        });
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Descargar" }));
    await waitFor(() =>
      expect(saved).toEqual([{ name: "hearth-export-2026-11-16.json", href: "blob:export" }]),
    );
    expect(asked).toEqual(["?format=json"]);
    // Revoking at once can cancel the download in Safari and older Firefox: the URL outlives the click.
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector("a[download]")).toBeNull();
  });

  it("downloads one space as CSV", async () => {
    const asked: string[] = [];
    renderExport({ [EXPORT]: (request) => (asked.push(new URL(request.url).search), zip()) });
    await userEvent.click(screen.getByRole("radio", { name: "CSV" }));
    await userEvent.click(screen.getByRole("radio", { name: /Solo un espacio/ }));
    const sheet = await screen.findByRole("dialog", { name: "Solo un espacio" });
    await userEvent.click(within(sheet).getByRole("radio", { name: "Hogar" }));
    expect(screen.getByRole("radio", { name: /Solo un espacio/ })).toHaveTextContent("Solo un espacioHogar");
    await userEvent.click(screen.getByRole("button", { name: "Descargar" }));
    await waitFor(() =>
      expect(saved).toEqual([{ name: "hearth-export-2026-11-16.zip", href: "blob:export" }]),
    );
    expect(asked).toEqual(["?format=csv&spaceId=sp-household"]);
  });

  it("asks to wait a minute after too many downloads", async () => {
    renderExport({ [EXPORT]: () => problemResponse(429, "TooManyRequests") });
    await userEvent.click(screen.getByRole("button", { name: "Descargar" }));
    // The toast host keeps a live region of its own: the screen's refusal is the one with the words.
    expect(
      (
        await screen.findByText(
          "Ya descargaste tus datos varias veces. Espera un minuto y vuelve a intentarlo.",
        )
      ).closest("[role=alert]"),
    ).not.toBeNull();
    expect(saved).toEqual([]);
  });

  it("lets the object URL go a minute after the click, not before", () => {
    vi.useFakeTimers();
    try {
      saveFile(new Blob(["{}"]), "hearth-export.json");
      expect(saved).toEqual([{ name: "hearth-export.json", href: "blob:export" }]);
      vi.advanceTimersByTime(REVOKE_AFTER_MS - 1);
      expect(URL.revokeObjectURL).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export");
    } finally {
      vi.useRealTimers();
    }
  });

  it("names the file itself when the answer names none", () => {
    expect(fileNameOf(null, "csv")).toBe("hearth-export.zip");
    expect(fileNameOf('attachment; filename="x.json"', "json")).toBe("x.json");
  });

  it("words the screen in English", () => {
    renderExport({}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Download my data" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Download" })).toBeVisible();
  });
});

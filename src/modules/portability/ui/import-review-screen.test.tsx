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
import type { ImportPreviewDto } from "./dto";
import { ImportReviewScreen } from "./import-review-screen";
import { previewFixture, resultFixture, SORTED_ACCOUNTS } from "./preview-fixture";

/** The block that pins a screen's main action (#281): sticky at the bottom, the gutter's 16 px above its buttons. */
const expectPinned = (action: HTMLElement) => {
  const block = action.closest(".sticky");
  expect(block).toHaveClass("sticky", "bottom-0", "pt-4", "bg-bg");
};

const ADJUST = "PATCH /api/v1/spaces/{spaceId}/imports/{importId}";
const CONFIRM = "POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm";
const BASE = "/spaces/sp-personal/data/imports/imp-1";

const renderReview = (
  preview: ImportPreviewDto = previewFixture(),
  routes: Record<string, FakeHandler> = {},
  locale: "es" | "en" = "es",
) => {
  const { api, requests } = fakeApi(routes);
  const onAdjusted = vi.fn();
  const onConfirmed = vi.fn();
  const view = renderWithIntl(
    <ImportReviewScreen
      backHref="/spaces/sp-personal/data"
      base={BASE}
      preview={preview}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      today="2026-11-16"
      timeZone="America/Bogota"
      draft={{ spaceId: "sp-personal", importId: "imp-1", onAdjusted, api }}
      onConfirmed={onConfirmed}
    />,
    { locale },
  );
  return { ...view, onAdjusted, onConfirmed, requests };
};

describe("Revisar importación (D28, board 3)", () => {
  it("counts as ya las tienes only the accounts that go into one of the person's, never a Persona or an Archivar (P337)", () => {
    // Bancolombia goes into an account Ana has; Mom and Jhon López are people, Cash and Card are archived.
    renderReview(previewFixture({ accounts: [...previewFixture().accounts, ...SORTED_ACCOUNTS] }));
    expect(
      screen.getByRole("link", { name: /Cuentas.*7 · 2 nuevas, 1 ya las tienes.*Revisar/ }),
    ).toBeVisible();
  });

  it("shows the dry run: counts, range, accounts, categories, zone and what stays out", async () => {
    const { container } = renderReview();
    expect(screen.getByRole("heading", { level: 1, name: "Revisar importación" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal/data");
    expect(screen.getByText("1.240 movimientos")).toBeVisible();
    expect(normalized(screen.getByText(/^Del /).textContent)).toBe("Del 6 may 2025 al 13 nov");
    const kinds = within(screen.getByLabelText("Movimientos por tipo"));
    expect(
      kinds
        .getAllByRole("term")
        .map((term, i) => [term.textContent, kinds.getAllByRole("definition")[i]!.textContent]),
    ).toEqual([
      ["Gastos", "830"],
      ["Ingresos", "104"],
      ["TransferenciasPagos de tarjeta y entre tus cuentas", "300"],
      ["Ajustes de saldo", "6"],
    ]);
    expect(
      screen.getByRole("link", { name: /Cuentas.*3 · 2 nuevas, 1 ya las tienes.*Revisar/ }),
    ).toHaveAttribute("href", `${BASE}/accounts`);
    expect(
      screen.getByRole("link", { name: /Categorías.*4 · 1 con la tuya, 3 nuevas.*Revisar/ }),
    ).toHaveAttribute("href", `${BASE}/categories`);
    expect(
      screen.getByRole("button", { name: /Zona horaria.*Bogota \(GMT-5\) · de tu perfil/ }),
    ).toBeVisible();
    const before = within(screen.getByRole("region", { name: "Antes de importar" }));
    expect(
      before.getByText(
        "3 movimientos se parecen a otros que ya tienes. Quedan fuera salvo que los incluyas.",
      ),
    ).toBeVisible();
    expect(before.getByText("No se importan 2 presupuestos.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Importar 1.237 movimientos" })).toBeEnabled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("draws the warnings in board 3's caution tone, and pins Importar at the bottom", () => {
    renderReview();
    const card = screen.getByRole("region", { name: "Antes de importar" });
    // The palette's mustard tint and ink (P135), whose dark pair keeps its contrast; never the debt tone.
    expect(card).toHaveClass("bg-[var(--pal-mustard-tint)]", "text-[var(--pal-mustard-ink)]");
    expect(card).not.toHaveClass("bg-owe-soft");
    expectPinned(screen.getByRole("button", { name: "Importar 1.237 movimientos" }));
  });

  it("says no later balance adjustment stays out: they import as adjustments (#329)", () => {
    renderReview(
      previewFixture({
        duplicates: [],
        leftOut: { budgets: 0, zeroAmountMovements: 0 },
        plan: { ...previewFixture().plan, adjustmentsNotImported: 2, adjustmentsInOpeningBalance: 1 },
      }),
    );
    const card = screen.getByRole("region", { name: "Antes de importar" });
    expect(card).toHaveTextContent("1 ajuste de saldo pasa al saldo inicial de su cuenta.");
    expect(card).not.toHaveTextContent(/aún no se importa/);
  });

  it("draws no warnings card when nothing stays out, and names an earlier import of the same file", () => {
    renderReview(
      previewFixture({
        duplicates: [],
        leftOut: { budgets: 0, zeroAmountMovements: 0 },
        previouslyImportedAt: "2026-11-15T15:00:00.000Z",
      }),
    );
    expect(normalized(screen.getByText(/Ya importaste este archivo/).textContent)).toBe(
      "Ya importaste este archivo el 15 nov. Solo traemos lo que falta.",
    );
    renderReview(previewFixture({ duplicates: [], leftOut: { budgets: 0, zeroAmountMovements: 0 } }));
    expect(screen.getAllByRole("region", { name: "Antes de importar" })).toHaveLength(1);
  });

  it("includes the look-alikes with one adjustment and hands on the new preview", async () => {
    const included = previewFixture({ includeDuplicates: ["m-7", "m-8", "m-9"] });
    const bodies: unknown[] = [];
    const { onAdjusted } = renderReview(previewFixture(), {
      [ADJUST]: async (request) => {
        bodies.push(await request.json());
        return jsonResponse(included);
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Incluirlos" }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledWith(included));
    expect(bodies).toEqual([{ includeDuplicates: ["m-7", "m-8", "m-9"] }]);
  });

  it("says included look-alikes are imported, and leaves them out again", async () => {
    const bodies: unknown[] = [];
    renderReview(previewFixture({ includeDuplicates: ["m-7", "m-8", "m-9"] }), {
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(previewFixture())),
    });
    expect(screen.getByText("3 movimientos que se parecen a otros que ya tienes se importan.")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Dejarlos fuera" }));
    await waitFor(() => expect(bodies).toEqual([{ includeDuplicates: [] }]));
  });

  it("changes the zone the times are read in from its sheet", async () => {
    const bodies: unknown[] = [];
    const { onAdjusted } = renderReview(previewFixture(), {
      [ADJUST]: async (request) => {
        bodies.push(await request.json());
        return jsonResponse(previewFixture({ timeZone: "Europe/Madrid" }));
      },
    });
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria/ }));
    const sheet = await screen.findByRole("dialog", { name: "Zona horaria" });
    await userEvent.type(within(sheet).getByLabelText("Busca una ciudad o zona"), "Madrid");
    await userEvent.click(within(sheet).getByRole("radio", { name: /^Madrid/ }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledOnce());
    expect(bodies).toEqual([{ timeZone: "Europe/Madrid" }]);
  });

  it("confirms with one idempotency key, the same one after a refusal", async () => {
    const keys: (string | null)[] = [];
    let refuse = true;
    const { onConfirmed } = renderReview(previewFixture(), {
      [CONFIRM]: (request) => {
        keys.push(request.headers.get("idempotency-key"));
        if (refuse) return ((refuse = false), problemResponse(503, "ServiceUnavailable"));
        return jsonResponse(resultFixture());
      },
    });
    await userEvent.click(screen.getByRole("button", { name: "Importar 1.237 movimientos" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(onConfirmed).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Importar 1.237 movimientos" }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith(resultFixture()));
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
  });

  it("shows why a confirm was refused", async () => {
    renderReview(previewFixture(), { [CONFIRM]: () => problemResponse(409, "ImportNotDraft") });
    await userEvent.click(screen.getByRole("button", { name: /^Importar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(es.errors.ImportNotDraft);
  });

  it("shows a mapping refusal with its reason", async () => {
    renderReview(previewFixture(), {
      [ADJUST]: () =>
        problemResponse(422, "InvalidImportMapping", { reason: "currencyMismatch", sourceId: "a-3" }),
    });
    await userEvent.click(screen.getByRole("button", { name: "Incluirlos" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(es.errors.InvalidImportMapping);
    expect(alert).toHaveTextContent("Elige una cuenta en la misma moneda que tiene en Money Manager.");
  });

  it("names the source and the refused record's reason when a confirm cannot create it", async () => {
    renderReview(previewFixture(), {
      [CONFIRM]: () =>
        problemResponse(409, "ImportTargetRefused", { sourceId: "a-3", reason: "AccountNameTaken" }),
    });
    await userEvent.click(screen.getByRole("button", { name: /^Importar/ }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(es.errors.ImportTargetRefused);
    expect(alert).toHaveTextContent("Es sobre «Cuenta en dólares».");
    expect(alert).toHaveTextContent(es.errors.AccountNameTaken);
  });

  it("asks to wait when too many imports are running", async () => {
    renderReview(previewFixture(), { [CONFIRM]: () => problemResponse(429, "TooManyRequests") });
    await userEvent.click(screen.getByRole("button", { name: /^Importar/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Hay muchas importaciones en curso. Intenta de nuevo en un momento.",
    );
  });

  it("has nothing to confirm when every movement is already in Hearth", () => {
    renderReview(previewFixture({ plan: { ...previewFixture().plan, movements: 0 } }));
    expect(screen.getByRole("button", { name: "Nada nuevo para importar" })).toBeDisabled();
  });

  it("words the review in English", () => {
    renderReview(previewFixture(), {}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Review import" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Import 1.237 movements" })).toBeVisible();
  });
});

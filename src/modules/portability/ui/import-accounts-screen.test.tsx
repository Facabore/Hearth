import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { es } from "@/i18n/messages/full";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { accountDto, cop, normalized } from "../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { ImportPreviewDto } from "./dto";
import { ImportAccountsScreen } from "./import-accounts-screen";
import { previewFixture } from "./preview-fixture";

const ADJUST = "PATCH /api/v1/spaces/{spaceId}/imports/{importId}";
const REVIEW = "/spaces/sp-personal/data/imports/imp-1";
const MINE = [
  accountDto({ id: "acc-bancolombia", name: "Bancolombia", type: "SAVINGS", balance: cop(1_469_600) }),
  accountDto({ id: "acc-cash", name: "Billetera", type: "CASH" }),
];

const renderAccounts = (
  preview: ImportPreviewDto = previewFixture(),
  routes: Record<string, FakeHandler> = {},
  locale: "es" | "en" = "es",
) => {
  const { api } = fakeApi(routes);
  const onAdjusted = vi.fn();
  const view = renderWithIntl(
    <ImportAccountsScreen
      backHref={REVIEW}
      preview={preview}
      accounts={MINE}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      draft={{ spaceId: "sp-personal", importId: "imp-1", onAdjusted, api }}
    />,
    { locale },
  );
  return { ...view, onAdjusted };
};

const card = (name: string) => screen.getByRole("button", { name: `${name}: Dónde va esta cuenta` });

describe("Cuentas a importar (D28, board 4)", () => {
  it("shows each account with what it goes to and its closing balance in the file", async () => {
    const { container } = renderAccounts();
    expect(screen.getByRole("heading", { level: 1, name: "Cuentas a importar" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", REVIEW);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Ahorros Bancolombia",
      "Visa Oro",
      "Cuenta en dólares",
    ]);
    expect(normalized(card("Ahorros Bancolombia").textContent)).toBe(
      "Usar BancolombiaTu cuenta · Ahorro o CDT",
    );
    expect(normalized(card("Visa Oro").textContent)).toBe(
      "Nueva cuenta: Tarjeta de créditoCOP · corte el 15, pago el 30",
    );
    expect(normalized(card("Cuenta en dólares").textContent)).toBe("Nueva cuenta: BancoUSD");
    expect(normalized(screen.getByText(/1.469.600/).closest("p")!.textContent)).toBe(
      "Saldo al final en Money Manager: $ 1.469.600",
    );
    expect(normalized(screen.getByText(/512,40/).closest("p")!.textContent)).toBe(
      "Saldo al final en Money Manager: US$ 512,40",
    );
    expect(screen.getByRole("link", { name: "Listo" })).toHaveAttribute("href", REVIEW);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows four accounts of a long list until the person asks for the rest", async () => {
    const base = previewFixture().accounts[2]!;
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...base,
      sourceId: `x-${i}`,
      name: `Cuenta ${i + 1}`,
    }));
    renderAccounts(previewFixture({ accounts: many }));
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(4);
    await userEvent.click(screen.getByRole("button", { name: "y 2 cuentas más" }));
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(6);
  });

  it("makes a new account of another type, in the file's currency", async () => {
    const bodies: unknown[] = [];
    const adjusted = previewFixture();
    const { onAdjusted } = renderAccounts(previewFixture(), {
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(adjusted)),
    });
    await userEvent.click(card("Visa Oro"));
    const sheet = await screen.findByRole("dialog", { name: "Visa Oro" });
    // Only accounts in the file's currency are offered; a new one keeps it.
    expect(
      within(sheet)
        .getAllByRole("radio")
        .slice(0, 3)
        .map((r) => r.textContent),
    ).toEqual([
      "Crear una cuenta nueva",
      "Usar BancolombiaTu cuenta · Ahorro o CDT",
      "Usar BilleteraTu cuenta · Efectivo",
    ]);
    expect(within(sheet).getByText("En COP, la moneda que tiene en Money Manager.")).toBeVisible();
    await userEvent.click(within(sheet).getByRole("radio", { name: "Efectivo" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledWith(adjusted));
    expect(bodies).toEqual([{ accounts: { "a-2": { kind: "new", type: "CASH", currency: "COP" } } }]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("maps an account to one the person already has", async () => {
    const bodies: unknown[] = [];
    renderAccounts(previewFixture(), {
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(previewFixture())),
    });
    await userEvent.click(card("Visa Oro"));
    const sheet = await screen.findByRole("dialog", { name: "Visa Oro" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /Usar Billetera/ }));
    expect(within(sheet).queryByRole("radiogroup", { name: "Tipo de cuenta" })).toBeNull();
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ accounts: { "a-2": { kind: "existing", accountId: "acc-cash" } } }]),
    );
  });

  it("says when the person has no account in the file's currency", async () => {
    renderAccounts();
    await userEvent.click(card("Cuenta en dólares"));
    const sheet = await screen.findByRole("dialog", { name: "Cuenta en dólares" });
    expect(within(sheet).getByText("No tienes cuentas en USD: se crea una nueva.")).toBeVisible();
  });

  it("keeps the sheet open with the refusal and its reason", async () => {
    const { onAdjusted } = renderAccounts(previewFixture(), {
      [ADJUST]: () =>
        problemResponse(422, "InvalidImportMapping", {
          details: { reason: "currencyMismatch", sourceId: "a-2" },
        }),
    });
    await userEvent.click(card("Visa Oro"));
    const sheet = await screen.findByRole("dialog", { name: "Visa Oro" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Guardar" }));
    const alert = await within(sheet).findByRole("alert");
    expect(alert).toHaveTextContent(es.errors.InvalidImportMapping);
    expect(alert).toHaveTextContent("Elige una cuenta en la misma moneda que tiene en Money Manager.");
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it("words the screen in English", () => {
    renderAccounts(previewFixture(), {}, "en");
    expect(screen.getByRole("heading", { level: 1, name: "Accounts to import" })).toBeVisible();
    expect(screen.getByText("New account: Credit card")).toBeVisible();
  });
});

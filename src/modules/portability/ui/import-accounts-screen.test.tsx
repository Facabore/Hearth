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
import { ImportAccountsScreen } from "./import-accounts-screen";
import { previewFixture, SORTED_ACCOUNTS } from "./preview-fixture";

/** The block that pins a screen's main action (#281): sticky at the bottom, the gutter's 16 px above its buttons. */
const expectPinned = (action: HTMLElement) => {
  const block = action.closest(".sticky");
  expect(block).toHaveClass("sticky", "bottom-0", "pt-4", "bg-bg");
};

const ADJUST = "PATCH /api/v1/spaces/{spaceId}/imports/{importId}";
const REVIEW = "/spaces/sp-personal/data/imports/imp-1";

/** Board 1's draft: three money accounts, two people and two accounts to archive. */
const sorted = () => previewFixture({ accounts: [...previewFixture().accounts, ...SORTED_ACCOUNTS] });

const renderAccounts = (
  preview: ImportPreviewDto = sorted(),
  routes: Record<string, FakeHandler> = {},
  locale: "es" | "en" = "es",
) => {
  const { api } = fakeApi(routes);
  const onAdjusted = vi.fn();
  const view = renderWithIntl(
    <ImportAccountsScreen
      backHref={REVIEW}
      preview={preview}
      formats={{ numberFormat: "DOT_COMMA", dateFormat: "DMY" }}
      draft={{ spaceId: "sp-personal", importId: "imp-1", onAdjusted, api }}
    />,
    { locale },
  );
  return { ...view, onAdjusted };
};

/** Text as read, without the no-break spaces and the word joiner that keep an amount on one line. */
const plain = (text: string | null | undefined) => normalized(text).replace(/\u2060/g, "");

/** One account's row: its name, the line under it, and its Cuenta / Persona / Archivar choice. */
const rowOf = (name: string) => screen.getByText(name, { selector: "p" }).closest("li")!;
const choiceOf = (name: string) => within(rowOf(name)).getByRole("group", { name: `Qué es ${name}` });
const pressed = (name: string) =>
  within(choiceOf(name))
    .getAllByRole("button")
    .filter((b) => b.getAttribute("aria-pressed") === "true")
    .map((b) => b.textContent);

describe("¿Qué es cada cuenta? (P337, board 1)", () => {
  it("sorts the accounts under what Hearth suggested, each with its balance and its choice", async () => {
    const { container } = renderAccounts();
    expect(screen.getByRole("heading", { level: 1, name: "Importar de Money Manager" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", REVIEW);
    expect(screen.getByRole("heading", { level: 2, name: "¿Qué es cada cuenta?" })).toBeVisible();
    expect(
      screen.getByText("Hearth sugirió qué es cada una de tus 7 cuentas. Cámbialo si no es así."),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Cuentas de dinero · 3",
      "Personas · 2",
      "Archivar · 2",
    ]);
    expect(pressed("Ahorros Bancolombia")).toEqual(["Cuenta"]);
    expect(pressed("Mom Loan")).toEqual(["Persona"]);
    expect(pressed("Cash")).toEqual(["Archivar"]);
    expect(
      within(choiceOf("Visa Oro"))
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Cuenta", "Persona", "Archivar"]);
    expect(screen.getByRole("link", { name: "Continuar" })).toHaveAttribute("href", REVIEW);
    expectPinned(screen.getByRole("link", { name: "Continuar" }));
    expect(await axeViolations(container)).toEqual([]);
  });

  it("says who owes whom for a Persona, and why for Archivar, never by color alone", () => {
    renderAccounts();
    const line = (name: string) => plain(rowOf(name).querySelector("p + p")!.textContent);
    expect(line("Ahorros Bancolombia")).toBe("$ 1.469.600");
    expect(line("Visa Oro")).toBe("−$ 500.000");
    expect(line("Mom Loan")).toBe("$ 500.000 · te debe");
    expect(line("Jhon López")).toBe("−$ 120.000 · le debes");
    expect(line("Cash")).toBe("$ 0 · igual a Efectivo");
    expect(line("Card")).toBe("$ 0 · sin movimientos");
  });

  it("sends the mapping the preview offers for the choice, and keeps the row in its section", async () => {
    const bodies: unknown[] = [];
    const base = sorted();
    const adjusted = previewFixture({
      accounts: base.accounts.map((a) =>
        a.sourceId === "a-4"
          ? { ...a, mapping: { kind: "new", type: "OTHER", currency: "COP", name: "Mom Loan" } }
          : a,
      ),
    });
    const { onAdjusted } = renderAccounts(base, {
      [ADJUST]: async (request) => (bodies.push(await request.json()), jsonResponse(adjusted)),
    });
    await userEvent.click(within(choiceOf("Mom Loan")).getByRole("button", { name: "Cuenta" }));
    await waitFor(() => expect(onAdjusted).toHaveBeenCalledWith(adjusted));
    expect(bodies).toEqual([{ accounts: { "a-4": { kind: "new", type: "OTHER", currency: "COP" } } }]);

    await userEvent.click(within(choiceOf("Card")).getByRole("button", { name: "Persona" }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toEqual({ accounts: { "a-7": { kind: "person", name: "Card" } } });
  });

  it("sends nothing when the person taps what is chosen already", async () => {
    const adjust = vi.fn(() => jsonResponse(sorted()));
    renderAccounts(sorted(), { [ADJUST]: adjust });
    await userEvent.click(within(choiceOf("Cash")).getByRole("button", { name: "Archivar" }));
    expect(adjust).not.toHaveBeenCalled();
  });

  it("shows the refusal, naming the account and why", async () => {
    const { onAdjusted } = renderAccounts(sorted(), {
      [ADJUST]: () =>
        problemResponse(422, "InvalidImportMapping", { reason: "currencyMismatch", sourceId: "a-3" }),
    });
    await userEvent.click(within(choiceOf("Cuenta en dólares")).getByRole("button", { name: "Persona" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(es.errors.InvalidImportMapping);
    expect(alert).toHaveTextContent("Cuenta en dólares");
    expect(onAdjusted).not.toHaveBeenCalled();
  });

  it("gives every choice a target of at least 44 px", () => {
    renderAccounts();
    for (const button of within(choiceOf("Visa Oro")).getAllByRole("button")) {
      expect(button).toHaveClass("min-h-11", "min-w-11");
    }
  });

  it("words the screen in English", () => {
    renderAccounts(sorted(), {}, "en");
    expect(screen.getByRole("heading", { level: 2, name: "What is each account?" })).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([
      "Money accounts · 3",
      "People · 2",
      "Archive · 2",
    ]);
    expect(plain(rowOf("Mom Loan").querySelector("p + p")!.textContent)).toBe("$ 500.000 · owes you");
  });
});

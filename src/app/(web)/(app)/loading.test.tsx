import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import es from "@/i18n/messages/es.json";
import { renderWithIntl } from "../../../../tests/support/ui/render";

/** `getTranslations(namespace)` over the Spanish catalog, the way the server resolves it. */
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  return {
    getTranslations: async (namespace?: string) =>
      createTranslator({ locale: "es", messages: es, namespace: namespace as never }),
  };
});

const { default: AppLoading } = await import("./loading");
const { default: SpaceLoading } = await import("./spaces/[spaceId]/loading");
const { default: TransactionsLoading } = await import("./spaces/[spaceId]/transactions/loading");
const { default: EditLoading } = await import("./spaces/[spaceId]/transactions/[transactionId]/edit/loading");
const { default: RecordLoading } = await import("./spaces/[spaceId]/new/loading");
const { default: AccountsLoading } = await import("./spaces/[spaceId]/accounts/loading");
const { default: NewAccountLoading } = await import("./spaces/[spaceId]/accounts/new/loading");
const { default: EditAccountLoading } = await import("./spaces/[spaceId]/accounts/[accountId]/edit/loading");
const { default: CategoriesLoading } = await import("./spaces/[spaceId]/categories/loading");
const { default: MembersLoading } = await import("./spaces/[spaceId]/members/loading");
const { default: HistoryLoading } = await import("./spaces/[spaceId]/members/[memberId]/history/loading");
const { default: BalancesLoading } = await import("./spaces/[spaceId]/balances/loading");
const { default: PlanLoading } = await import("./spaces/[spaceId]/plan/loading");
const { default: SettingsLoading } = await import("./settings/loading");

const show = async (loading: () => Promise<ReactElement> | ReactElement) => renderWithIntl(await loading());

describe("the loading boundaries of the app's routes (#196)", () => {
  it.each([
    ["the edit of a transaction", EditLoading, "Editar movimiento", "../.."],
    ["the record form", RecordLoading, "Registrar movimiento", "."],
    ["the accounts", AccountsLoading, "Cuentas", "."],
    ["a new account", NewAccountLoading, "Nueva cuenta", "../accounts"],
    ["the edit of an account", EditAccountLoading, "Editar cuenta", "../../accounts"],
    ["the categories", CategoriesLoading, "Categorías", "."],
    ["the members", MembersLoading, "Miembros", "."],
    ["a member's history", HistoryLoading, "Cargando…", "../../balances"],
    ["the settings", SettingsLoading, "Ajustes", "/"],
  ])("shows %s with its own header and way back", async (_name, loading, title, back) => {
    await show(loading);
    expect(screen.getByRole("region", { name: "Cargando…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", back);
  });

  it.each([
    ["the start", AppLoading],
    ["the home of a space", SpaceLoading],
    ["the transactions", TransactionsLoading],
    ["the balances", BalancesLoading],
    ["the plan", PlanLoading],
  ])("shows %s, reached from the navigation, without a header", async (_name, loading) => {
    const { container } = await show(loading);
    expect(screen.getByRole("region", { name: "Cargando…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(container.querySelector("a, button")).toBeNull();
  });
});

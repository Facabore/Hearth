import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
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

const APP = join("src", "app", "(web)", "(app)");

/** Every file named `name` under the signed-in routes, as its folder relative to them. */
const folders = (name: string) =>
  readdirSync(APP, { recursive: true })
    .map(String)
    .filter((file) => file === name || file.endsWith(`${sep}${name}`))
    .map((file) => dirname(file))
    .sort();

const LOADINGS = import.meta.glob<{ default: () => Promise<ReactElement> | ReactElement }>(
  "./**/loading.tsx",
);

const loadingOf = async (folder: string) =>
  (await LOADINGS[`./${folder.split(sep).join("/")}/loading.tsx`]!()).default;

const show = async (folder: string) => renderWithIntl(await (await loadingOf(folder))());

describe("the loading boundaries of the app's routes (#196)", () => {
  it("gives every screen a boundary of its own, and the start, which only redirects, none", () => {
    const pages = folders("page.tsx");
    expect(pages).toContain(".");
    expect(folders("loading.tsx")).toEqual(pages.filter((page) => page !== "."));
  });

  it("never wraps another route in a boundary: one there would start the stream before that route's 404 or redirect", () => {
    const pages = folders("page.tsx");
    for (const boundary of folders("loading.tsx"))
      expect(
        pages.filter((page) => page.startsWith(`${boundary}${sep}`)),
        boundary,
      ).toEqual([]);
  });

  it("puts each boundary under a layout that renders the screen first on a document request", () => {
    for (const folder of folders("loading.tsx"))
      expect(readFileSync(join(APP, folder, "layout.tsx"), "utf8"), folder).toMatch(
        /import Page from "\.\/page";[\s\S]*export default documentFirst\(Page\);/,
      );
  });

  it.each([
    ["spaces/[spaceId]/transactions/[transactionId]/edit", "Editar movimiento", "../.."],
    ["spaces/[spaceId]/new", "Registrar movimiento", "."],
    ["spaces/[spaceId]/accounts/(list)", "Cuentas", "."],
    ["spaces/[spaceId]/accounts/new", "Nueva cuenta", "../accounts"],
    ["spaces/[spaceId]/accounts/[accountId]/edit", "Editar cuenta", "../../accounts"],
    ["spaces/[spaceId]/categories", "Categorías", "."],
    ["spaces/[spaceId]/members/(list)", "Miembros", "."],
    ["spaces/[spaceId]/members/[memberId]/history", "Cargando…", "../../balances"],
    ["spaces/[spaceId]/plans/[planId]/(planner)", "Cargando…", "../../plan"],
    ["spaces/[spaceId]/plans/[planId]/capacities", es.budgeting.capacity.title, "."],
    ["spaces/[spaceId]/plans/[planId]/lines/new", es.budgeting.lineEditor.newTitle, ".."],
    ["spaces/[spaceId]/plans/[planId]/lines/[lineId]", "Cargando…", "../.."],
    ["settings", "Ajustes", "/"],
    ["spaces/new", es.spaces.new.title, "/"],
  ])("shows %s with its own header and way back", async (folder, title, back) => {
    await show(folder.split("/").join(sep));
    expect(screen.getByRole("region", { name: "Cargando…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("heading", { level: 1, name: title })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", back);
  });

  it.each([
    "spaces/[spaceId]/(home)",
    "spaces/[spaceId]/transactions/(list)",
    "spaces/[spaceId]/balances",
    "spaces/[spaceId]/plan/(overview)",
    "spaces/[spaceId]/plan/lines",
    "spaces/[spaceId]/plan/groups",
    "spaces/[spaceId]/plan/trend",
    "spaces/[spaceId]/plan/members",
    "spaces/[spaceId]/plan/fund",
    "spaces/[spaceId]/plan/calendar",
  ])("shows %s, reached from the navigation or its tabs, without a header", async (folder) => {
    const { container } = await show(folder.split("/").join(sep));
    expect(screen.getByRole("region", { name: "Cargando…" })).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(container.querySelector("a, button")).toBeNull();
  });
});

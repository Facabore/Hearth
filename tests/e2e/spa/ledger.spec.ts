import { randomInt } from "node:crypto";
import { expect, test, type Locator, type Route } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { get, post, signUp } from "../support/seed";

/**
 * ADR 0006's tap-to-content gate on cached navigation. Its proof is the API held: from the cached visits on, no
 * `/api/v1` request is answered until every assertion has run, so content on screen can only come from the query
 * cache. The time is a second check: the old server-rendered tap measured 240 to 420 ms on a desktop (ADR 0006), and a
 * cached one must stay under that.
 */
const CACHED_TAP_MS = 300;

/** Today in Bogotá, the person's zone: the movement must sit in the period Movimientos opens on. */
const todayInBogota = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(new Date());

test.describe("the ledger flow (slice 2 of #199, ADR 0006)", () => {
  test("a second visit to Movimientos, the sheet and Editar shows content without waiting on the network", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const spaceId = await signUp(page, "spa-ledger", ip);
    const space = `/api/v1/spaces/${spaceId}`;
    const account = await post(page, `${space}/accounts`, {
      name: "Bancolombia",
      type: "BANK",
      openingBalance: { amount: "200000000", currency: "COP" },
    });
    const { items: groups } = await get(page, `${space}/categories`);
    await post(
      page,
      `${space}/expenses`,
      {
        description: "Pan",
        date: todayInBogota(),
        categoryId: groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id,
        amount: { amount: "1200000", currency: "COP" },
        accountId: account.id,
      },
      { "idempotency-key": crypto.randomUUID() },
    );

    // The first visits read the API: Movimientos, the row's sheet, Editar, then back to Inicio.
    const nav = page.getByRole("navigation", { name: es.shell.nav.main });
    const row = page.getByRole("link", { name: /Pan/ });
    const sheet = page.getByRole("dialog", { name: "Pan" });
    const save = page.getByRole("button", { name: es.ledger.edit.save });
    await page.goto(`/spaces/${spaceId}/transactions`);
    await expect(row).toBeVisible();
    await row.click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("link", { name: es.ledger.detail.edit }).click();
    await expect(save).toBeVisible();
    await nav.getByRole("link", { name: es.shell.nav.home }).click();
    await expect(page.getByRole("heading", { name: es.home.recent })).toBeVisible();

    const held: Route[] = [];
    await page.route("**/api/v1/**", (route) => {
      held.push(route);
    });
    const timings: string[] = [];
    const tap = async (screen: string, target: Locator, content: Locator) => {
      const started = Date.now();
      await target.click();
      await expect(content).toBeVisible({ timeout: CACHED_TAP_MS });
      timings.push(`${screen} ${Date.now() - started} ms`);
    };
    await tap("Movimientos", nav.getByRole("link", { name: es.shell.nav.transactions }), row);
    await tap("sheet", row, sheet);
    await tap("Editar", sheet.getByRole("link", { name: es.ledger.detail.edit }), save);
    await expect(page.getByLabel(es.ledger.form.description)).toHaveValue("Pan");

    // Every request since the hold is still unanswered: the screens painted without one.
    expect(held.length).toBeGreaterThan(0);
    test.info().annotations.push({ type: "tap-to-content", description: timings.join(", ") });
    console.log(`tap-to-content on cached navigation: ${timings.join(", ")}`);
    await page.unrouteAll({ behavior: "ignoreErrors" });
    await Promise.all(held.map((route) => route.continue().catch(() => undefined)));
    expect(errors).toEqual([]);
  });
});

import { randomInt } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { test, todayInBogota } from "../support/clock";
import { es } from "../../../src/i18n/messages/full";
import { get, post, signUp } from "../support/seed";
import { sheetsSettled } from "../support/sheets";

/**
 * Ruling P307 (the QA of 2026-11-07): Volver, the browser's Back and closing a sheet never trap the person, never
 * reopen what they closed or saved, and never drop what they typed without asking.
 */
const ip = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const nav = (page: Page) => page.getByRole("navigation", { name: es.shell.nav.main });
const dialog = (page: Page, name: string) => page.getByRole("dialog", { name });
const withMovement = async (page: Page, spaceId: string, description: string) => {
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
      description,
      date: todayInBogota(),
      categoryId: groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id,
      amount: { amount: "1200000", currency: "COP" },
      accountId: account.id,
    },
    { "idempotency-key": crypto.randomUUID() },
  );
};

test.describe("back navigation (ruling P307)", () => {
  test("Nueva cuenta closes to Cuentas for good, and a saved account is one Back from Inicio", async ({
    page,
  }) => {
    const spaceId = await signUp(page, "spa-back-accounts", ip());
    const home = `/spaces/${spaceId}`;
    const cuentas = `${home}/accounts`;
    await page.goto(home);
    await page.getByRole("link", { name: es.home.allAccounts }).click();
    await page.getByRole("link", { name: es.accounts.new }).click();
    await expect(dialog(page, es.accounts.newTitle)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(cuentas);
    // Volver used to reopen Nueva cuenta, forever: Cuentas has no bottom bar to escape by.
    await page.getByRole("link", { name: es.common.back }).click();
    await expect(page).toHaveURL(home);
    await page.goBack();
    await expect(page).not.toHaveURL(/accounts\/new/);

    await page.goto(home);
    await page.getByRole("link", { name: es.home.allAccounts }).click();
    await page.getByRole("link", { name: es.accounts.new }).click();
    await expect(dialog(page, es.accounts.newTitle)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(cuentas);
    await page.goBack();
    await expect(page).toHaveURL(home);

    await page.getByRole("link", { name: es.home.allAccounts }).click();
    await page.getByRole("link", { name: es.accounts.new }).click();
    await page.getByRole("radio", { name: "Efectivo" }).click();
    await page.getByLabel("Nombre").fill("Caja menor");
    await page.getByRole("button", { name: es.accounts.create }).click();
    await expect(page.getByRole("link", { name: /^Caja menor/ })).toBeVisible();
    await expect(page).toHaveURL(cuentas);
    await page.goBack();
    await expect(page).toHaveURL(home);
  });

  test("closing Nueva cuenta or leaving Editar cuenta with something typed asks first", async ({ page }) => {
    const spaceId = await signUp(page, "spa-back-discard", ip());
    const cuentas = `/spaces/${spaceId}/accounts`;
    await page.goto(cuentas);
    await page.getByRole("link", { name: es.accounts.new }).click();
    await page.getByRole("radio", { name: "Efectivo" }).click();
    await page.getByLabel("Nombre").fill("Caja menor");
    await page.keyboard.press("Escape");
    const question = dialog(page, es.accounts.discard.new);
    await question.getByRole("button", { name: es.accounts.discard.keep }).click();
    await expect(page.getByLabel("Nombre")).toHaveValue("Caja menor");
    await page.goBack();
    await expect(question).toBeVisible();
    // The address stays on the form while the question shows.
    await expect(page).toHaveURL(/accounts\/new/);
    await question.getByRole("button", { name: es.accounts.discard.confirm }).click();
    await expect(page).toHaveURL(cuentas);
    await expect(dialog(page, es.accounts.newTitle)).toBeHidden();

    await page.getByRole("link", { name: /^Efectivo.*Editar/ }).click();
    await page.getByLabel("Nombre").fill("Efectivo diario");
    await page.getByRole("link", { name: es.common.back }).click();
    const changes = dialog(page, es.accounts.discard.edit);
    await changes.getByRole("button", { name: es.accounts.discard.keep }).click();
    await expect(page.getByLabel("Nombre")).toHaveValue("Efectivo diario");
    await page.goBack();
    await changes.getByRole("button", { name: es.accounts.discard.confirm }).click();
    await expect(page).toHaveURL(cuentas);
  });

  test("a movement saved, edited or reopened is one Back from the list", async ({ page }) => {
    const spaceId = await signUp(page, "spa-back-ledger", ip());
    const home = `/spaces/${spaceId}`;
    const list = `${home}/transactions`;
    await withMovement(page, spaceId, "Pan");
    await page.goto(home);
    await nav(page).getByRole("link", { name: es.shell.nav.transactions }).click();
    await expect(page.getByRole("heading", { level: 1, name: es.shell.nav.transactions })).toBeVisible();
    const row = page.getByRole("link", { name: /Pan/ }).first();
    const sheet = dialog(page, "Pan");

    // Editar, then Volver back to the sheet: closing it leaves the list one Back away from Inicio.
    await row.click();
    await sheet.getByRole("link", { name: es.ledger.detail.edit }).click();
    await page.getByRole("link", { name: es.common.back }).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(list);
    await page.goBack();
    await expect(page).toHaveURL(home);

    // Saved from Editar: back on its sheet, then one Back closes it.
    await nav(page).getByRole("link", { name: es.shell.nav.transactions }).click();
    await expect(page.getByRole("heading", { level: 1, name: es.shell.nav.transactions })).toBeVisible();
    await row.click();
    await sheet.getByRole("link", { name: es.ledger.detail.edit }).click();
    await page.getByRole("button", { name: "5" }).click();
    await page.getByRole("button", { name: es.ledger.edit.save }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page).toHaveURL(/transactions\?tx=/);
    await page.goBack();
    await expect(page).toHaveURL(list);
    await expect(page.getByRole("dialog")).toBeHidden();

    // Registrar from Inicio: saved, Inicio is where it lands, and one Back leaves Inicio for Movimientos.
    await nav(page).getByRole("link", { name: es.shell.nav.home }).click();
    await nav(page).getByRole("link", { name: es.shell.nav.record }).click();
    for (const digit of ["3", "000"]) await page.getByRole("button", { name: digit, exact: true }).click();
    await page.getByRole("button", { name: "Arriendo", exact: true }).click();
    await page.getByRole("button", { name: es.ledger.form.save.EXPENSE }).click();
    await expect(page).toHaveURL(home);
    await page.goBack();
    await expect(page).toHaveURL(list);
  });

  test("Back closes a sheet over a screen and keeps what was typed under it", async ({ page }) => {
    const spaceId = await signUp(page, "spa-back-sheets", ip());
    const home = `/spaces/${spaceId}`;
    const categories = `${home}/categories`;
    await page.goto(home);
    await page.goto(categories);
    await page.getByRole("button", { name: "Editar Arriendo" }).click();
    await expect(dialog(page, es.categories.sheet.editTitle)).toBeVisible();
    const edit = dialog(page, es.categories.sheet.editTitle);
    await edit.getByLabel("Nombre").fill("Arriendo casa");
    await page.goBack();
    await expect(edit).toBeHidden();
    await expect(page).toHaveURL(categories);
    await expect(page.getByRole("heading", { level: 1, name: es.categories.title })).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar Arriendo" })).toBeVisible();
    // The sheet's entry is gone: one more Back leaves Categorías.
    await page.goBack();
    await expect(page).toHaveURL(home);

    // Closed by Escape, it gives its entry back too.
    await page.goto(`/settings?from=${spaceId}`);
    await page.getByRole("button", { name: new RegExp(`^${es.settings.numbersAndDates}`) }).click();
    await expect(dialog(page, es.settings.numbersAndDates)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page, es.settings.numbersAndDates)).toBeHidden();
    await sheetsSettled(page);
    await page.goBack();
    await expect(page).toHaveURL(home);
  });

  test("the record form's question keeps the address on the form while it shows", async ({ page }) => {
    const spaceId = await signUp(page, "spa-back-record", ip());
    const home = `/spaces/${spaceId}`;
    await page.goto(home);
    await nav(page).getByRole("link", { name: es.shell.nav.record }).click();
    for (const digit of ["2", "000"]) await page.getByRole("button", { name: digit, exact: true }).click();
    await page.goBack();
    const question = dialog(page, es.ledger.form.discard.title.EXPENSE);
    await expect(question).toBeVisible();
    await expect(page).toHaveURL(/\/new/);
    await question.getByRole("button", { name: es.ledger.form.discard.confirm }).click();
    await expect(page).toHaveURL(home);
  });
});

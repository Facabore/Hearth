import type { Locator, Page } from "@playwright/test";
import { es } from "../../../src/i18n/messages/full";

/** The record form's picker (ruling P291, board B1 · 03), opened from the tile that lists every category. */
export const openCategoryPicker = async (page: Page) => {
  await page.getByRole("button", { name: es.ledger.form.chooseCategory, exact: true }).click();
  const picker = page.getByRole("dialog", { name: es.categories.picker.title });
  await picker.getByRole("searchbox").waitFor();
  return picker;
};

/**
 * Chooses a category in the record form's picker: a name is searched for, a pattern is looked for group by group (the
 * picker shows one group's categories at a time). A category with subcategories is chosen without one.
 */
export const chooseCategory = async (page: Page, name: string | RegExp) => {
  const picker = await openCategoryPicker(page);
  const radio = picker.getByRole("radio", { name, exact: typeof name === "string" }).first();
  if (typeof name === "string") await picker.getByRole("searchbox").fill(name);
  else
    for (const group of await picker.locator("button[aria-controls='category-panel']").all()) {
      if (await radio.isVisible()) break;
      await group.click();
    }
  await radio.click();
  // Either the picker closes, or it asks for a subcategory.
  const none = picker.getByRole("radio", { name: es.categories.picker.none });
  await Promise.race([picker.waitFor({ state: "hidden" }), none.waitFor()]);
  if (await none.isVisible()) await none.click();
};

/**
 * Ruling P333: the personal Registrar's one row, "Pagaste tú con … · para …" over "Quién pagó y para quién", opens
 * "¿Quién pagó y para quién?", where the account paid from is chosen in "Desde".
 */
export const openWhoPaid = async (page: Page) => {
  await page.getByRole("button", { name: new RegExp(es.ledger.split.title) }).click();
  const sheet = page.getByRole("dialog", { name: es.ledger.who.title });
  await sheet.waitFor();
  return sheet;
};

/** The "Desde" chips of an open "¿Quién pagó y para quién?". */
export const payFromChoices = (sheet: Locator) => sheet.getByRole("radiogroup", { name: es.ledger.who.from });

/** P333: pays a personal expense from `account`, chosen in the sheet's "Desde", and closes the sheet with Listo. */
export const payFrom = async (page: Page, account: string) => {
  const sheet = await openWhoPaid(page);
  await payFromChoices(sheet)
    .getByRole("radio", { name: new RegExp(account) })
    .click();
  await sheet.getByRole("button", { name: es.ledger.split.done }).click();
  await sheet.waitFor({ state: "hidden" });
};

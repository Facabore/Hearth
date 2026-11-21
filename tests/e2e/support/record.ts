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
 * P348: the account a new expense or income asks for once its category is chosen. A name or pattern picks that account;
 * left out, the first one offered. `null` says the form asks for nothing: a shared space's expense, an edit, a form
 * opened on an account's screen, or one whose account is already chosen.
 */
export type AskedAccount = { readonly account?: string | RegExp | null };

/**
 * Chooses a category in the record form's picker: a name is searched for, a pattern is looked for group by group (the
 * picker shows one group's categories at a time). A category with subcategories is chosen without one. Then, unless
 * `account` is `null`, it answers the account sheet the choice opens (P348, `chooseAskedAccount`).
 */
export const chooseCategory = async (page: Page, name: string | RegExp, { account }: AskedAccount = {}) => {
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
  if (account !== null) await chooseAskedAccount(page, account);
};

const radioOf = (scope: Locator, account: string | RegExp | undefined) =>
  account === undefined
    ? scope.getByRole("radio").first()
    : scope.getByRole("radio", { name: typeof account === "string" ? new RegExp(account) : account });

/**
 * P348: once a new expense or income has its category and no account, the form asks for one as the category picker
 * closes: a personal expense opens "¿Quién pagó y para quién?", where the account is chosen in "Desde" and Listo (which
 * waits for an amount) closes it; an income opens its account picker, which closes on the choice. `account` is a name
 * or a pattern; left out, the first account offered.
 */
export const chooseAskedAccount = async (page: Page, account?: string | RegExp) => {
  const who = page.getByRole("dialog", { name: es.ledger.who.title });
  const picker = page
    .getByRole("dialog", { name: es.ledger.form.receivingAccount, exact: true })
    .or(page.getByRole("dialog", { name: es.ledger.form.account, exact: true }));
  await who.or(picker).waitFor();
  if (await who.isVisible()) {
    await radioOf(payFromChoices(who), account).click();
    await who.getByRole("button", { name: es.ledger.split.done }).click();
    await who.waitFor({ state: "hidden" });
  } else {
    await radioOf(picker, account).click();
    await picker.waitFor({ state: "hidden" });
  }
};

/**
 * Ruling P333: the personal Registrar's one row, "Pagaste tú con … · para …" over "Quién pagó y para quién", opens
 * "¿Quién pagó y para quién?", where the account paid from is chosen in "Desde". The sheet a category already opened
 * (P348) is the same one, so it is used as it is.
 */
export const openWhoPaid = async (page: Page) => {
  const sheet = page.getByRole("dialog", { name: es.ledger.who.title });
  if (!(await sheet.isVisible()))
    await page.getByRole("button", { name: new RegExp(es.ledger.split.title) }).click();
  await sheet.waitFor();
  return sheet;
};

/** The "Desde" chips of an open "¿Quién pagó y para quién?". */
export const payFromChoices = (sheet: Locator) => sheet.getByRole("radiogroup", { name: es.ledger.who.from });

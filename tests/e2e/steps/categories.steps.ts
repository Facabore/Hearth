import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { openSpaceSettings } from "../support/space-settings";
import { openCategoryPicker } from "../support/record";
import type { World } from "../support/world";

const ACTIONS: Record<string, string> = { "Archive instead": "categories.sheet.archiveInstead" };
// P292: board Categorías 02 titles every edit sheet "Editar categoría"; only one is open at a time.
const sheetOf = (page: Page, world: World) =>
  page.getByRole("dialog", { name: world.t("categories.sheet.editTitle") });

Given(
  /^the category "([^"]+)" has (\d+) transactions$/,
  async ({ world }, category: string, count: string) => {
    for (let i = 1; i <= Number(count); i++)
      await world.recordExpense(`${category} ${i}`, "10,000", category, "Bancolombia");
  },
);

When(
  /^"([^"]+)" opens the categories screen from her space's settings and deletes "([^"]+)"$/,
  async ({ page, world }, name: string, category: string) => {
    expect(name).toBe(world.user!.name);
    await page.goto(`/spaces/${world.user!.spaceId}`);
    // Ruling P309: a space's categories are in its own settings, from the space switcher.
    await openSpaceSettings(page, world);
    await page.getByRole("link", { name: world.t("spaces.screen.categories"), exact: true }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await page.getByRole("button", { name: world.t("categories.edit", { name: category }) }).click();
    const sheet = sheetOf(page, world);
    await sheet.getByRole("button", { name: world.t("categories.sheet.delete") }).click();
    await sheet.getByRole("button", { name: world.t("categories.sheet.delete") }).click();
  },
);

Then(
  /^the message of the key "([^"]+)" is shown with the action "([^"]+)"$/,
  async ({ page, world }, key: string, action: string) => {
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("alert")).toContainText(world.t(key));
    await expect(sheet.getByRole("button", { name: world.t(ACTIONS[action]!) })).toBeVisible();
  },
);

When(/^"([^"]+)" chooses "(Archive instead)"$/, async ({ page, world }, _name: string, action: string) => {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: world.t(ACTIONS[action]!) })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

Then(
  /^"([^"]+)" moves to the archived section and is no longer offered in the expense form$/,
  async ({ page, world }, category: string) => {
    await expect(page.getByRole("region", { name: world.t("categories.archived.title") })).toContainText(
      category,
    );
    await expect(
      page.getByRole("button", { name: world.t("categories.edit", { name: category }) }),
    ).toHaveCount(0);
    await page.goto(`/spaces/${world.user!.spaceId}/new`);
    await expect(page.locator("[data-ready='true']")).toBeAttached();
    const picker = await openCategoryPicker(page);
    await expect(picker.getByRole("radio").first()).toBeVisible();
    // Searched by name, so the archived category would show whichever group holds it.
    await picker.getByRole("searchbox").fill(category);
    await expect(picker.getByRole("radio", { name: category })).toHaveCount(0);
  },
);

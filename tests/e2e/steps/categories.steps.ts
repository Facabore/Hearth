import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import type { World } from "../support/world";

const ACTIONS: Record<string, string> = { "Archive instead": "categories.sheet.archiveInstead" };
const sheetOf = (page: Page, world: World, name: string) =>
  page.getByRole("dialog", { name: world.t("categories.sheet.editTitle", { name }) });

Given(
  /^the category "([^"]+)" has (\d+) transactions$/,
  async ({ world }, category: string, count: string) => {
    for (let i = 1; i <= Number(count); i++)
      await world.recordExpense(`${category} ${i}`, "10,000", category, "Bancolombia");
  },
);

When(
  /^"([^"]+)" opens the categories screen from her profile and deletes "([^"]+)"$/,
  async ({ page, world }, name: string, category: string) => {
    await page.goto(`/spaces/${world.user!.spaceId}`);
    await page.getByRole("button", { name: world.t("shell.profile.open", { name }) }).click();
    await page.getByRole("link", { name: new RegExp(world.t("shell.profile.categories")) }).click();
    await expect(page).toHaveURL(/\/categories$/);
    await page.getByRole("button", { name: world.t("categories.edit", { name: category }) }).click();
    const sheet = sheetOf(page, world, category);
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
    await page.getByRole("button", { name: new RegExp(world.t("ledger.form.category")) }).click();
    const picker = page.getByRole("dialog", { name: world.t("categories.picker.title") });
    await expect(picker.getByRole("radio").first()).toBeVisible();
    await expect(picker.getByRole("radio", { name: category })).toHaveCount(0);
  },
);

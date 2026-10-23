import { expect, type Page } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";
import type { World } from "../support/world";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const list = (world: World) => `/spaces/${world.user!.spaceId}/transactions`;
const sheet = (page: Page) => page.getByRole("dialog");
/** A row is a link whose name starts with its description (ruling P189). */
const rowLink = (page: Page, description: string) =>
  page.getByRole("link", { name: new RegExp(`^${description}`) });
const openRow = async (page: Page, world: World, description: string) => {
  await page.goto(list(world));
  await rowLink(page, description).click();
  await expect(sheet(page)).toBeVisible();
};
/** The edit form is hydrated once its record form says so (the same marker the record scenarios wait for). */
const ready = (page: Page) => expect(page.locator("[data-ready='true']")).toBeAttached();

Given(
  /^"([^"]+)" recorded "([^"]+)" for ([\d,]+) COP in "([^"]+)" from "([^"]+)"$/,
  async ({ world }, _name: string, description: string, pesos: string, category: string, account: string) => {
    await world.recordExpense(description, pesos, category, account);
  },
);

When(
  /^"([^"]+)" opens "([^"]+)" from the transaction list$/,
  async ({ page, world }, _n: string, description: string) => openRow(page, world, description),
);

When(
  /^"([^"]+)" opens "([^"]+)" from the transaction list and chooses "([^"]+)"$/,
  async ({ page, world }, _n: string, description: string, action: string) => {
    await openRow(page, world, description);
    await sheet(page).getByRole("button", { name: action }).click();
  },
);

Then(
  /^the detail sheet shows "([^"]+)", ([\d,]+) COP, "([^"]+)" and "([^"]+)"$/,
  async ({ page }, type: string, pesos: string, category: string, account: string) => {
    const text = norm(await sheet(page).textContent());
    for (const part of [type, norm(shown(pesos)), category, account]) expect(text).toContain(part);
  },
);

When(
  /^"([^"]+)" chooses "Editar", changes the amount to ([\d,]+) COP(?: and the description to "([^"]+)")? and saves$/,
  async ({ page, world }, _n: string, pesos: string, description?: string) => {
    await sheet(page)
      .getByRole("link", { name: world.t("ledger.detail.edit") })
      .click();
    await ready(page);
    await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
    if (description) await page.getByLabel(world.t("ledger.form.description")).fill(description);
    await page.getByRole("button", { name: world.t("ledger.edit.save") }).click();
  },
);

// The toast speaks in the layout's live regions, outside <main> (they exist before any message, WCAG 4.1.3).
const toast = (page: Page, message: string) => page.getByRole("status").filter({ hasText: message });

Then(/^the status message reads "([^"]+)"$/, async ({ page }, message: string) => {
  await expect(toast(page, message)).toBeVisible();
});

Then(
  /^the status message reads "([^"]+)" with the action "([^"]+)"$/,
  async ({ page }, message: string, action: string) => {
    await expect(toast(page, message)).toBeVisible();
    await expect(toast(page, message).getByRole("button", { name: action })).toBeVisible();
  },
);

When(/^"[^"]+" chooses "Deshacer"$/, async ({ page }) => {
  await page.getByRole("status").getByRole("button", { name: "Deshacer" }).click();
});

Then(/^"([^"]+)" is not in the transaction list$/, async ({ page, world }, description: string) => {
  // Deleting leaves the sheet for the list; a row hidden behind an open sheet would pass for a deleted one.
  await expect(sheet(page)).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`${list(world)}$`));
  await expect(rowLink(page, description)).toHaveCount(0);
});

Then(
  /^the transaction list shows "([^"]+)" with ([\d,]+) COP$/,
  async ({ page, world }, description: string, pesos: string) => {
    // An open sheet makes the rows behind it inert: close it the way a person does (Escape), staying in the app so the
    // rows are the ones the saved change refreshed. Away from the list, open it.
    if (await sheet(page).isVisible()) {
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeHidden();
    }
    if (!new URL(page.url()).pathname.endsWith("/transactions")) await page.goto(list(world));
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: description });
    await expect(row).toBeVisible();
    expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
  },
);

Given(
  /^"([^"]+)" opened the edit form of "([^"]+)"$/,
  async ({ page, world }, _n: string, description: string) => {
    const id = world.transactions.get(description)!;
    await page.goto(`${list(world)}/${id}/edit?returnTo=${encodeURIComponent(list(world))}`);
    await ready(page);
  },
);

Given(
  /^"([^"]+)" was renamed to "([^"]+)" somewhere else$/,
  async ({ world }, description: string, renamed: string) => {
    const id = world.transactions.get(description)!;
    await world.api.patch(`/api/v1/spaces/${world.user!.spaceId}/transactions/${id}`, {
      description: renamed,
    });
  },
);

When(
  /^"([^"]+)" changes the amount to ([\d,]+) COP and saves$/,
  async ({ page, world }, _n: string, pesos: string) => {
    await page.getByLabel(world.t("ledger.form.amount")).fill(pesos.replaceAll(",", ""));
    await page.getByRole("button", { name: world.t("ledger.edit.save") }).click();
  },
);

Then(/^the form shows the message of the key "([^"]+)"$/, async ({ page, world }, key: string) => {
  await expect(page.getByRole("main").getByText(world.t(key))).toBeVisible();
});

Then(
  /^the amount of "([^"]+)" is still ([\d,]+) COP$/,
  async ({ world }, description: string, pesos: string) => {
    const id = world.transactions.get(description)!;
    const tx = (await world.api.get(`/api/v1/spaces/${world.user!.spaceId}/transactions/${id}`)) as {
      amount: { amount: string };
    };
    expect(tx.amount.amount).toBe(minor(pesos));
  },
);

When(/^"[^"]+" chooses "Cargar la última versión"$/, async ({ page, world }) => {
  await page.getByRole("button", { name: world.t("ledger.edit.reload") }).click();
});

Then(
  /^the form shows the description "([^"]+)" and the amount ([\d,]+) COP$/,
  async ({ page, world }, description: string, pesos: string) => {
    await expect(page.getByLabel(world.t("ledger.form.description"))).toHaveValue(description);
    // The amount field writes the number only; the symbol belongs to the label around it.
    await expect(page.getByLabel(world.t("ledger.form.amount"))).toHaveValue(
      norm(shown(pesos)).replace(/^\S+\s/, ""),
    );
  },
);

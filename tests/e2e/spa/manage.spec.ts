import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import es from "../../../src/i18n/messages/es.json" with { type: "json" };
import { signUp } from "../support/seed";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const scan = async (page: Page, where: string) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};

test.describe("accounts, categories and settings (slice 3 of #199, ADR 0006)", () => {
  test("creates an account, sees the categories and changes a format, against the real API", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const spaceId = await signUp(page, "spa-manage", ip);

    // Accounts: the starter accounts, then a new one from the form, which lands on the list.
    await page.goto(`/spaces/${spaceId}/accounts`);
    await expect(page.getByRole("heading", { level: 1, name: es.accounts.title })).toBeVisible();
    await scan(page, "accounts");
    await page.goto(`/spaces/${spaceId}/accounts/new`);
    await page.getByRole("radio", { name: "Efectivo" }).click();
    await page.getByLabel("Nombre").fill("Caja menor");
    await page.getByLabel("Saldo inicial").fill("150.000");
    await scan(page, "new account");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await expect(page).toHaveURL(`/spaces/${spaceId}/accounts`);
    await expect(page.getByRole("link", { name: /^Caja menor/ })).toBeVisible();

    // Categories: the seeded tree, read-write for the owner.
    await page.goto(`/spaces/${spaceId}/categories`);
    await expect(page.getByRole("heading", { level: 1, name: es.categories.title })).toBeVisible();
    await scan(page, "categories");

    // Settings: the number format applies to every screen at once, from the profile's answer.
    await page.goto(`/settings?from=${spaceId}`);
    await expect(page.getByRole("heading", { name: es.settings.title })).toBeVisible();
    await scan(page, "settings");
    // U8 (#224): the formats sit in the "Números y fechas" sheet.
    await page.getByRole("button", { name: new RegExp(`^${es.settings.numbersAndDates}`) }).click();
    await scan(page, "settings, numbers and dates");
    await page.getByRole("radio", { name: "1,234,567.89" }).click();
    await expect(page.getByRole("radio", { name: "1,234,567.89" })).toBeChecked();
    await page.goto(`/spaces/${spaceId}/accounts`);
    await expect(page.getByText(/150,000/).first()).toBeVisible();

    // New space: the form inside the shell of the space it started from (N3).
    await page.goto(`/spaces/new?from=${spaceId}`);
    await expect(page.getByRole("button", { name: "Crear espacio" })).toBeVisible();
    await scan(page, "new space");

    expect(errors).toEqual([]);
  });
});

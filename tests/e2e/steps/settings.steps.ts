import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor } from "../support/money";

/** The feature's English names, as keys of the Spanish screen. */
const KEYS: Record<string, string> = {
  Formats: "settings.formats",
  Region: "settings.region",
  "Appearance and language": "settings.appearance",
  Space: "spaces.settings.title",
  "12-hour": "settings.timeFormat.H12",
  "24-hour": "settings.timeFormat.H24",
};
const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
/** A sample label is the formatter's own text; a named choice ("12-hour") is a catalog message. */
const labelOf = (world: { t: (key: string) => string }, choice: string) =>
  KEYS[choice] ? world.t(KEYS[choice]) : choice;

Given(
  /^"([^"]+)" is signed in with the locale "([^"]+)" and the timezone "([^"]+)"$/,
  async ({ page, world }, name: string, locale: string, zone: string) => {
    await world.signUp(name, { timezone: zone });
    await world.api.patch("/api/v1/me", { locale });
    await page.goto("/");
  },
);

Given(
  /^the installation rules are numberFormat "([^"]+)", timeFormat "([^"]+)", dateFormat "([^"]+)" and weekStart "([^"]+)"$/,
  async ({ world }, numberFormat: string, timeFormat: string, dateFormat: string, weekStart: string) => {
    const me = (await world.api.get("/api/v1/me")) as { preferences: { defaults: Record<string, string> } };
    expect(me.preferences.defaults).toMatchObject({ numberFormat, timeFormat, dateFormat, weekStart });
  },
);

When("{string} opens the Settings screen", async ({ page, world }, name: string) => {
  expect(name).toBe(world.user!.name);
  await page.goto("/settings");
});

Then(
  /^it shows the sections "([^"]+)", "([^"]+)", "([^"]+)" and "([^"]+)"$/,
  async ({ page, world }, first: string, second: string, third: string, fourth: string) => {
    const sections = [first, second, third, fourth];
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(sections.map((s) => world.t(KEYS[s]!)));
  },
);

Then(
  /^the preview reads "([^"]+)", "([^"]+)" and "([^"]+)"$/,
  async ({ page, world }, first: string, second: string, third: string) => {
    const samples = [first, second, third];
    // Each saved choice also says Guardado in a status of its own (U5): the preview is the one that is named.
    const preview = page.getByRole("status", { name: world.t("settings.preview.label") });
    for (const sample of samples) await expect(preview).toContainText(sample);
  },
);

When(
  /^"([^"]+)" chooses the number format "([^"]+)", the date format "([^"]+)" and the time format "([^"]+)"$/,
  async ({ page, world }, _name: string, number: string, date: string, time: string) => {
    const choices = [number, date, time];
    for (const choice of choices) {
      const stored = page.waitForResponse(
        (r) => r.url().endsWith("/api/v1/me") && r.request().method() === "PATCH" && r.status() === 200,
      );
      await page.getByRole("radio", { name: labelOf(world, choice), exact: true }).click();
      await stored;
    }
  },
);

Then(
  /^each choice is stored as she makes it and the preview reads "([^"]+)", "([^"]+)" and "([^"]+)"$/,
  async ({ page, world }, first: string, second: string, third: string) => {
    const samples = [first, second, third];
    const me = (await world.api.get("/api/v1/me")) as {
      preferences: { stored: Record<string, string | null> };
    };
    expect(me.preferences.stored).toMatchObject({
      numberFormat: "COMMA_DOT",
      dateFormat: "MDY",
      timeFormat: "H12",
    });
    const preview = page.getByRole("status", { name: world.t("settings.preview.label") });
    for (const sample of samples) await expect(preview).toContainText(sample);
  },
);

When(/^she renames her space "([^"]+)"$/, async ({ page, world }, name: string) => {
  const stored = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/api/v1/spaces/${world.user!.spaceId}`) &&
      r.request().method() === "PATCH" &&
      r.status() === 200,
  );
  const field = page.getByLabel(world.t("spaces.settings.name"));
  await field.fill(name);
  await field.press("Enter");
  await stored;
});

Then(
  /^it says "Guardado" and the space switcher and the Plan tab name her space "([^"]+)"$/,
  async ({ page, world }, name: string) => {
    await expect(page.getByRole("status").filter({ hasText: world.t("settings.saved") })).toBeVisible();
    // The shell around Settings is the renamed space's: the refresh renames it in the switcher at once.
    await expect(page.getByRole("button", { name: world.t("shell.space.current", { name }) })).toBeVisible();
    const space = (await world.api.get(`/api/v1/spaces/${world.user!.spaceId}`)) as { name: string };
    expect(space.name).toBe(name);
    await page.goto(`/spaces/${world.user!.spaceId}/plan`);
    await expect(page.getByRole("main").getByText(name, { exact: true })).toBeVisible();
  },
);

Then(
  "the transaction list shows her amounts, dates and times in the new formats",
  async ({ page, world }) => {
    const space = `/api/v1/spaces/${world.user!.spaceId}`;
    const account = (await world.api.post(`${space}/accounts`, {
      name: "Bancolombia",
      type: "BANK",
      openingBalance: { amount: "0", currency: "COP" },
    })) as { id: string };
    const { items } = (await world.api.get(`${space}/categories`)) as {
      items: { categories: { id: string }[] }[];
    };
    await world.record("expenses", {
      description: "Market",
      date: "2026-10-16",
      occurredAt: "2026-10-16T19:30:00.000Z",
      timeZone: "America/Bogota",
      categoryId: items.flatMap((g) => g.categories)[0]!.id,
      amount: { amount: minor("1,234,567.89"), currency: "COP" },
      accountId: account.id,
    });
    await page.goto(`/spaces/${world.user!.spaceId}/transactions?period=2026-10`);
    await expect(page.getByRole("heading", { level: 2, name: "10/16/2026" })).toBeVisible();
    const row = page.getByRole("listitem").filter({ hasText: "Market" });
    expect(norm(await row.textContent())).toContain("$ 1,234,567.89");
    expect(norm(await row.textContent())).toContain("2:30 PM");
  },
);

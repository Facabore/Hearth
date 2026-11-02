import { expect } from "@playwright/test";
import type { DataTable } from "playwright-bdd";
import { Given, Then, When } from "../support/fixtures";
import { shown } from "../support/money";
import {
  clientOf,
  householdOf,
  seedAccounts,
  seedE74Movements,
  seedE7Expenses,
  seedHousehold,
  seedReferencePlan,
} from "../support/plan-seed";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const LINE_NAMES: Record<string, string> = { Unbudgeted: "reports.lines.unbudgeted" };
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

Given(
  /^the ACTIVE reference plan for (\S+) in "([^"]+)" and the E7 shared fixture expenses$/,
  async ({ world }, period: string, name: string) => {
    await world.signUp("Ana");
    const hh = await seedHousehold(world, { name, member: "Juan", role: "MEMBER" });
    const accounts = await seedAccounts(world, hh);
    // The E7 fixture keeps Free off the catch-all, so Restaurants stays Unbudgeted (HU-E7-01, ruling P34).
    await seedReferencePlan(clientOf(world), hh, {
      period,
      catchAll: false,
      activate: true,
      savingsAccountId: accounts.savings,
    });
    await seedE7Expenses(clientOf(world), hh, accounts);
  },
);

When(/^"[^"]+" opens the dashboard of "[^"]+" for (\S+)$/, async ({ page, world }, period: string) => {
  await page.goto(`/spaces/${householdOf(world).spaceId}/plan?period=${period}`);
});

/** Board E9-10 01 (ruling P272): each line a compact item, its available at the right and "spent of planned" below. */
Then("the line cards show:", async ({ page, world }, table: DataTable) => {
  const list = page.getByRole("main").getByRole("list", { name: world.t("reports.lines.caption") });
  await expect(list).toBeVisible();
  const money = (amount: string) => norm(shown(amount.replace(" COP", "")));
  for (const row of table.hashes()) {
    const unbudgeted = Boolean(LINE_NAMES[row.line!]);
    const name = unbudgeted ? world.t(LINE_NAMES[row.line!]!) : row.line!;
    const item = list.getByRole("listitem", { name: new RegExp(`^${escaped(name)}`) });
    await expect(item).toHaveCount(1);
    // The bar is presentation: its width follows spent over planned, never a figure of its own.
    await expect(item.locator("[data-bar]")).toHaveCount(1);
    const figure = norm(await item.locator("[data-figure]").textContent());
    const caption = norm(await item.locator("[data-caption]").textContent());
    // A line spent exactly as planned says so in words instead of its zero (#214).
    const onPlan = !unbudgeted && row.available === "0 COP" && row.spent === row.planned;
    expect(figure).toBe(
      onPlan
        ? world.t("reports.lines.onPlan")
        : `${world.t("reports.lines.available")} ${money(row.available!)}`,
    );
    expect(caption).toContain(money(row.spent!));
    if (!unbudgeted) expect(caption).toContain(money(row.planned!));
  }
});

Given(
  /^"([^"]+)" has the November 2026 movements of the HU-E7-04 fixture$/,
  async ({ world }, who: string) => {
    await world.signUp(who);
    const hh = await seedHousehold(world, { name: "Household", member: "Juan", role: "MEMBER" });
    await seedE74Movements(world, hh, await seedAccounts(world, hh));
  },
);

When(/^"[^"]+" opens her unified view for (\S+)$/, async ({ page, world }, period: string) => {
  // Ruling P267: Mi consumo, the stacked screen Inicio's shortcut opens.
  await page.goto(`/spaces/${world.user!.spaceId}/my-consumption?period=${period}`);
});

Then(
  /^it shows consumption ([\d,]+) COP and cash out ([\d,]+) COP$/,
  async ({ page, world }, consumption: string, cashOut: string) => {
    const region = (key: string) =>
      page.getByRole("main").getByRole("region", { name: world.t(key), exact: true });
    expect(norm(await region("reports.unified.spent").textContent())).toContain(norm(shown(consumption)));
    expect(norm(await region("reports.unified.paid").textContent())).toContain(norm(shown(cashOut)));
  },
);

Then(
  /^"([^"]+)" from her personal space and "[^"]+" is one row of ([\d,]+) COP$/,
  async ({ page, world }, category: string, amount: string) => {
    // The row takes the name Ana's personal space gives the catalog key (ruling P76), so the API names it.
    const view = (await world.api.get("/api/v1/me/unified-view?period=2026-11")) as {
      consumption: { categories: { key: string | null; name: string }[] };
    };
    const row = view.consumption.categories.find((c) => c.key === category.toLowerCase())!;
    const items = page.getByRole("main").getByRole("listitem", { name: row.name, exact: true });
    await expect(items).toHaveCount(1);
    expect(norm(await items.textContent())).toContain(norm(shown(amount)));
  },
);

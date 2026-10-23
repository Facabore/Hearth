import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import {
  clientOf,
  seedAccounts,
  seedE7Expenses,
  seedHousehold,
  seedReferencePlan,
} from "./support/plan-seed";
import { World } from "./support/world";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** The phone of the audit (UI Definition of Done): every screen is scanned at 390 x 844. */
const PHONE = { width: 390, height: 844 };

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`plan screens in ${colorScheme} (UI Definition of Done)`, () => {
    test.use({ colorScheme, viewport: PHONE });

    test("every M6c screen and sheet has no WCAG 2.1 AA violation", async ({
      page,
      playwright,
    }, testInfo) => {
      test.setTimeout(180_000);
      const scan = async (where: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        ).toEqual([]);
      };
      // The dashboards' Background (HU-E9-10): the ACTIVE reference plan of 2026-11 and the E7 expenses.
      const world = new World(
        page,
        testInfo.testId,
        colorScheme === "light" ? "10.253.0.1" : "10.253.0.2",
        playwright.request,
      );
      await page.context().setExtraHTTPHeaders(world.headers());
      try {
        await world.signUp("Ana");
        const household = await seedHousehold(world, { name: "Household", member: "Juan", role: "MEMBER" });
        const accounts = await seedAccounts(world, household);
        const ana = clientOf(world);
        const { planId, lineIds } = await seedReferencePlan(ana, household, {
          period: "2026-11",
          catchAll: false,
          activate: true,
          savingsAccountId: accounts.savings,
        });
        await seedE7Expenses(ana, household, accounts);
        // December copies November, so the line trend ending 2026-12 has a previous period; 2027-01 has no plan.
        await ana.post(`/api/v1/spaces/${household.spaceId}/plans`, {
          period: "2026-12",
          copyFrom: "previous",
        });

        const hh = `/spaces/${household.spaceId}`;
        const me = `/spaces/${world.user!.spaceId}`;
        for (const path of [
          `${hh}/plan?period=2026-11`,
          `${hh}/plan?period=2027-01`,
          `${hh}/plan/members?period=2026-11`,
          `${hh}/plan/fund?period=2026-11`,
          `${hh}/plan/groups?period=2026-11`,
          `${hh}/plans/${planId}`,
          `${hh}/plans/${planId}/capacities`,
          `${hh}/plans/${planId}/lines/new`,
          `${me}/plan?period=2026-11`,
          `${me}/plan/groups?period=2026-11`,
          `${me}/plan/lines?period=2026-11`,
        ]) {
          await page.goto(path);
          await scan(path);
        }
        // HU-E9-10: a period without a plan offers to create one (the no-plan card the scan above read).
        await page.goto(`${hh}/plan?period=2027-01`);
        await expect(page.getByRole("button", { name: es.budgeting.start.create })).toBeVisible();
        // The seeded groups' names depend on the seed's language, so the drill-down takes the first group.
        await page.goto(`${hh}/plan/groups?period=2026-11`);
        await page
          .getByRole("main")
          .getByRole("button", { name: /^Food|^Alimentación/ })
          .first()
          .click();
        await scan("spending by group, one level down");
        for (const path of [`${hh}/plan/trend?period=2026-12`, `${me}/plan/trend?period=2026-11`]) {
          await page.goto(path);
          await expect(page.getByTestId("trend-chart")).toBeVisible();
          await scan(path);
        }
        // The personal chart draws one dot per period of its window (HU-E9-11 "6 points"), in a real browser.
        await expect(page.locator("[data-testid='trend-chart'] .recharts-line-dot")).toHaveCount(6);
        await page.goto(`${hh}/plans/${planId}/lines/${lineIds.Home}`);
        await page.getByRole("button", { name: es.budgeting.mapping.choose }).click();
        await expect(page.getByRole("dialog").getByRole("checkbox").first()).toBeVisible();
        await scan("category mapping sheet");
        await page.keyboard.press("Escape");
        // The desktop width of the Plan tab. Task 16's overview (the member-by-line table) is not on this base.
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${hh}/plan?period=2026-11`);
        await expect(page.getByRole("table", { name: es.reports.lines.caption })).toBeVisible();
        await scan("desktop overview");
      } finally {
        await world.dispose();
      }
    });
  });
}

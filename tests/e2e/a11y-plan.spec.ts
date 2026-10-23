import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { BUILT_IN_FORMATS, formatSignedMoney } from "../../src/shared/ui/format/formatters";
import {
  categoryIdsByKey,
  clientOf,
  seedAccounts,
  seedE7Expenses,
  seedHome,
  seedHousehold,
  seedRecurrence,
  seedReferencePlan,
} from "./support/plan-seed";
import { World } from "./support/world";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** The phone of the audit (UI Definition of Done): every screen is scanned at 390 x 844. */
const PHONE = { width: 390, height: 844 };
const cop = (pesos: number) => ({ amount: String(BigInt(pesos) * 100n), currency: "COP" });

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
        const plans = `/api/v1/spaces/${household.spaceId}/plans`;
        // #143: November's Home rolls over, so December's copy says it carries from November once November closes.
        const { version } = (await ana.get(`${plans}/${planId}`)) as { version: number };
        await ana.send(
          "PATCH",
          `${plans}/${planId}/lines/${lineIds.Home}`,
          { rolloverMode: "ROLLOVER" },
          { "if-match": `"${version}"` },
        );
        // December copies November, so the line trend ending 2026-12 has a previous period; 2027-01 has no plan.
        await ana.post(plans, { period: "2026-12", copyFrom: "previous" });
        // #143: a CLOSED September whose Home rolls over, copied into an ACTIVE October that carries +170,000 COP.
        // October's Home (1,640,000 COP of budget, nothing spent) is also the record form's line (#142).
        await seedHome(ana, household, accounts, {
          period: "2026-09",
          rolloverMode: "ROLLOVER",
          close: true,
        });
        const october = (await ana.post(plans, { period: "2026-10", copyFrom: "previous" })) as {
          id: string;
          version: number;
        };
        await ana.post(`${plans}/${october.id}/activate`, {}, october.version);
        // #150: one INCOME and one CONFIRM EXPENSE recurrence of Ana's own account, inside the calendar's window.
        const personal = world.user!.spaceId;
        const keys = await categoryIdsByKey(ana, personal);
        const { items: members } = (await ana.get(`/api/v1/spaces/${personal}/members`)) as {
          items: { id: string }[];
        };
        const monthly = (day: number) => ({ kind: "MONTHLY", day });
        await seedRecurrence(ana, personal, {
          description: "Salario",
          amount: { amount: "300000000", currency: "COP" },
          template: { type: "INCOME", categoryId: keys.salary, accountId: accounts.bancolombia },
          schedule: monthly(30),
          mode: "AUTO",
          startDate: "2026-11-01",
        });
        await seedRecurrence(ana, personal, {
          description: "Internet",
          amount: { amount: "12000000", currency: "COP" },
          template: {
            type: "EXPENSE",
            categoryId: keys.utilities,
            payer: { memberId: members[0]!.id, accountId: accounts.bancolombia },
          },
          schedule: monthly(5),
          mode: "CONFIRM",
          startDate: "2026-11-05",
        });

        const hh = `/spaces/${household.spaceId}`;
        const me = `/spaces/${world.user!.spaceId}`;
        const states: Record<string, string> = {
          [`${me}/plan/calendar`]: "Internet",
          [`${me}/plan/calendar?days=60`]: es.reports.calendar.title.replace("{days}", "60"),
          [`${hh}/plan?period=2026-10`]: es.reports.lines.carryOver
            .replace("{amount}", formatSignedMoney(cop(170_000), BUILT_IN_FORMATS))
            .replace("{period}", "septiembre 2026"),
          [`${hh}/plan?period=2026-12`]: es.reports.lines.carryOverPending.replace(
            "{period}",
            "noviembre 2026",
          ),
        };
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
          // #150: the calendar's two windows.
          `${me}/plan/calendar`,
          `${me}/plan/calendar?days=60`,
          // #142, #143: a carried amount and the state badges, then a carry waiting for its plan to close.
          `${hh}/plan?period=2026-10`,
          `${hh}/plan?period=2026-12`,
        ]) {
          await page.goto(path);
          // The states the new paths exist for are on screen, so the scan reads them and not a fallback.
          const state = states[path];
          if (state) await expect(page.getByRole("main")).toContainText(state);
          await scan(path);
        }
        // #142 (ruling P235): the record form's neutral note, then its question before saving.
        await page.goto(`${hh}/new`);
        await expect(page.locator("[data-ready='true']")).toBeAttached();
        await page.getByLabel(es.ledger.form.amount).fill("1350000"); // 82 % of 1,640,000 COP: the neutral note
        await page.getByRole("button", { name: new RegExp(es.ledger.form.category) }).click();
        await page.getByRole("radio", { name: /^Mercado|^Groceries/ }).click();
        // NEAR only with October's carry: without it 1,350,000 COP is 91,84 % of 1,470,000 COP, a HIGH note.
        await expect(page.locator("[data-level='NEAR']")).toBeVisible();
        await scan("record form with the line note");
        await page.getByLabel(es.ledger.form.amount).fill("1700000"); // 60,000 COP over: the confirmation
        await page.getByRole("button", { name: es.ledger.form.save.EXPENSE }).click();
        await expect(page.getByRole("heading", { name: es.ledger.lineWarning.confirmTitle })).toBeFocused();
        await scan("record form asking before saving");
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
        // The desktop width of the Plan tab: Task 16's overview adds the member-by-line table (ruling P216).
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.goto(`${hh}/plan?period=2026-11`);
        await expect(page.getByRole("table", { name: es.reports.overview.matrixTitle })).toBeVisible();
        await scan("desktop overview");
      } finally {
        await world.dispose();
      }
    });
  });
}

import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type APIRequest, type Page } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { BASE_URL as BASE } from "./support/base-url";
import { Person } from "./support/people";
import { get, post, put, signUp } from "./support/seed";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
/** The phone of the audit (UI Definition of Done): every screen is scanned at 390 x 844. */
const PHONE = { width: 390, height: 844 };
const fill = (message: string, values: Record<string, string>) =>
  message.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`);
const ip = () => `10.249.${randomInt(256)}.${randomInt(1, 255)}`;
const idempotent = () => ({ "idempotency-key": crypto.randomUUID() });
const tokenOf = ({ url }: { url: string }) => new URL(url, BASE).pathname;

/**
 * Ana (the page) in a Household with Juan, the guest Pedro and Marta's pending email invitation; a pending link; a
 * fund that an expense took below zero; a settlement-ready balance (Ana paid a market that Juan owes half of); and
 * October's DRAFT plan (HU-E9-10), whose "Mercado" line the two expenses take over its budget.
 */
const seedHousehold = async (page: Page, requests: APIRequest, tag: string) => {
  const personal = await signUp(page, `a11y-shared-${tag}`, ip());
  const bank = await post(page, `/api/v1/spaces/${personal}/accounts`, {
    name: "Bancolombia",
    type: "BANK",
    openingBalance: { amount: "200000000", currency: "COP" },
  });
  const household = await post(page, "/api/v1/spaces", {
    kind: "SHARED",
    name: "Household",
    currency: "COP",
  });
  const space = `/api/v1/spaces/${household.id}`;
  const juan = await Person.signUp(requests, "Juan", `a11y-juan-${tag}-${Date.now()}@example.com`, {
    "x-forwarded-for": ip(),
  });
  try {
    const join = await post(page, `${space}/invitations`, { kind: "LINK", role: "MEMBER" });
    await juan.api.post(`/api/v1${tokenOf(join)}/accept`, {});
  } finally {
    await juan.dispose();
  }
  const pedro = await post(page, `${space}/guests`, { displayName: "Pedro" });
  await post(page, `${space}/invitations`, { kind: "EMAIL", email: "marta@example.com", role: "VIEWER" });
  const pending = await post(page, `${space}/invitations`, { kind: "LINK", role: "MEMBER" });
  const claim = await post(page, `${space}/guests/${pedro.id}/claim-links`, {});
  const fund = await post(page, `${space}/accounts`, {
    name: "Fondo Hogar",
    type: "SHARED_FUND",
    openingBalance: { amount: "0", currency: "COP" },
  });
  const { items: groups } = await get(page, `${space}/categories`);
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  const { items: members } = await get(page, `${space}/members`);
  const ana: string = members.find(
    (m: { kind: string; displayName: string }) => m.kind === "USER" && m.displayName === "Ana",
  ).id;
  const base = {
    date: "2026-10-31",
    occurredAt: "2026-10-31T17:00:00.000Z",
    timeZone: "America/Bogota",
    categoryId,
  };
  await post(
    page,
    `${space}/expenses`,
    {
      ...base,
      description: "Mercado",
      amount: { amount: "30000000", currency: "COP" },
      payments: [{ memberId: ana, accountId: bank.id, amount: { amount: "30000000", currency: "COP" } }],
    },
    idempotent(),
  );
  const overspent = await post(
    page,
    `${space}/expenses`,
    {
      ...base,
      description: "Arriendo",
      amount: { amount: "50000000", currency: "COP" },
      payments: [{ memberId: null, accountId: fund.id, amount: { amount: "50000000", currency: "COP" } }],
    },
    idempotent(),
  );
  // October is the period that holds the e2e clock's today. The plan answers its version after every write.
  const money = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });
  const guard = (version: number) => ({ "if-match": `"${version}"` });
  let plan = await post(page, `${space}/plans`, { period: "2026-10" });
  plan = await put(
    page,
    `${space}/plans/${plan.id}/capacities`,
    { capacities: [{ memberId: ana, amount: money(500_000) }] },
    guard(plan.version),
  );
  plan = await post(
    page,
    `${space}/plans/${plan.id}/lines`,
    { name: "Mercado", plannedAmount: money(100_000) },
    guard(plan.version),
  );
  plan = await post(
    page,
    `${space}/plans/${plan.id}/lines`,
    { name: "Ocio", plannedAmount: money(200_000) },
    guard(plan.version),
  );
  const market = plan.lines.find((line: { name: string }) => line.name === "Mercado");
  await put(
    page,
    `${space}/plans/${plan.id}/lines/${market.id}/categories`,
    { categoryIds: [categoryId] },
    guard(plan.version),
  );
  return {
    household: household.id as string,
    personal,
    ana,
    token: tokenOf(pending),
    claim: tokenOf(claim),
    fund: overspent.warnings[0].accountId as string,
  };
};

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`household screens in ${colorScheme} (UI Definition of Done)`, () => {
    test.use({ colorScheme, viewport: PHONE });

    test("every M6b screen and sheet has no WCAG 2.1 AA violation", async ({ page, playwright, browser }) => {
      const scan = async (where: string, on: Page = page) => {
        const { violations } = await new AxeBuilder({ page: on }).withTags(WCAG).analyze();
        expect(
          violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        ).toEqual([]);
      };
      const ids = await seedHousehold(page, playwright.request, colorScheme);
      const h = `/spaces/${ids.household}`;

      for (const path of [
        "/spaces/new",
        // N3 and N10: the shell of the shared space around Settings and New space, and the home with its members links.
        `/spaces/new?from=${ids.household}`,
        `/settings?from=${ids.household}`,
        h,
        `${h}/members`,
        `${h}/balances`,
        // HU-E9-10: the Plan tab of the household, with an overspent line, a line within its plan and Unbudgeted.
        `${h}/plan`,
        `${h}/members/${ids.ana}/history`,
        `${h}/transactions?notice=FundBalanceNegative&account=${ids.fund}`,
      ]) {
        await page.goto(path);
        await scan(path);
      }
      // HU-E9-10: the household's October plan reads as DRAFT, with the market line over its budget.
      await page.goto(`${h}/plan`);
      await expect(page.getByText(es.budgeting.status.DRAFT)).toBeVisible();
      await expect(page.getByText(es.reports.lines.overspent)).toBeVisible();
      // U1: a shared space with no funds explains them instead of asking for a first account.
      const bare = await post(page, "/api/v1/spaces", { kind: "SHARED", name: "Vacía", currency: "COP" });
      for (const path of [`/spaces/${bare.id}`, `/spaces/${bare.id}/accounts`]) {
        await page.goto(path);
        await expect(page.getByText(es.accounts.fundsNote)).toBeVisible();
        await scan(`${path} without funds`);
      }
      // U6: the one-time welcome after accepting an invitation.
      await page.goto(`${h}?joined=1`);
      await expect(page.getByRole("status")).toContainText("Household");
      await scan("home with the joined notice");
      await page.goto(`${h}/members`);
      await page.getByRole("button", { name: es.members.invite }).click();
      await page.getByRole("button", { name: es.members.inviteSheet.createLink }).click();
      await expect(page.getByLabel(es.members.inviteSheet.linkLabel, { exact: true })).toBeVisible();
      await scan("invite sheet with its link");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: es.members.addGuest }).click();
      await scan("add guest sheet");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", {
          name: fill(es.members.guestOptions, { name: `Pedro ${es.members.guestSuffix}` }),
        })
        .click();
      await scan("guest sheet");
      await page.getByRole("button", { name: es.members.guest.createClaim }).click();
      await scan("guest sheet with its claim link");
      await page.getByRole("button", { name: fill(es.members.guest.remove, { space: "Household" }) }).click();
      await scan("guest sheet asking to remove the guest");
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: fill(es.members.role, { name: "Juan", role: es.shell.role.MEMBER }) })
        .click();
      await scan("role sheet");
      await page.keyboard.press("Escape");

      await page.goto(`${h}/new`);
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await scan("shared expense form");
      await page.locator("#record-amount").fill("300000");
      await page.getByRole("button", { name: new RegExp(es.ledger.split.split) }).click();
      await scan("split sheet");
      await page.keyboard.press("Escape");

      await page.goto(`/spaces/${ids.personal}/new`);
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByRole("button", { name: es.ledger.direct.open }).click();
      await scan("split with someone sheet");
      await page.keyboard.press("Escape");

      await page.goto(`${h}/balances`);
      await page.getByRole("button", { name: es.balances.record }).click();
      await scan("settle-up sheet");
      await page.keyboard.press("Escape");
      await page.getByRole("button").filter({ hasText: es.balances.settle.action }).first().click();
      await scan("settle-up sheet prefilled from a suggestion");
      await page.keyboard.press("Escape");

      // The open pages, signed in (Ana) and as a visitor (a fresh context without cookies).
      for (const path of [ids.token, ids.claim]) {
        await page.goto(path);
        await scan(`${path} signed in`);
      }
      // AxeBuilder needs a page made from its own context.
      const context = await browser.newContext({ colorScheme, baseURL: BASE, viewport: PHONE });
      try {
        const visitor = await context.newPage();
        for (const path of [ids.token, ids.claim, "/invitations/not-a-token"]) {
          await visitor.goto(path);
          await scan(`${path} as a visitor`, visitor);
        }
      } finally {
        await context.close();
      }
    });
  });
}

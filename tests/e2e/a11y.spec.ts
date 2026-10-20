import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const post = async (page: Page, path: string, data: unknown, extra: Record<string, string> = {}) => {
  const response = await page.request.post(path, { data, headers: extra });
  if (!response.ok()) throw new Error(`POST ${path} answered ${response.status()}: ${await response.text()}`);
  return response.json();
};

/** A fresh person with a personal space and nothing else: her home shows the first-account card (P148). */
const signUp = async (page: Page, tag: string): Promise<string> => {
  await page
    .context()
    .setExtraHTTPHeaders({ "x-forwarded-for": tag === "light" ? "10.252.0.1" : "10.252.0.2" });
  await post(page, "/api/v1/auth/sign-up", {
    name: "Ana",
    email: `a11y-${tag}-${Date.now()}@example.com`,
    password: "123456789012",
    timezone: "America/Bogota",
  });
  const { items: spaces } = await (await page.request.get("/api/v1/spaces")).json();
  return spaces[0].id as string;
};

/** The same seeding as the e2e World: "Bancolombia", an archived "Old wallet", one expense in the first category. */
const seedLedger = async (page: Page, spaceId: string): Promise<void> => {
  const space = `/api/v1/spaces/${spaceId}`;
  const account = await post(page, `${space}/accounts`, {
    name: "Bancolombia",
    type: "BANK",
    openingBalance: { amount: "200000000", currency: "COP" },
  });
  const old = await post(page, `${space}/accounts`, {
    name: "Old wallet",
    type: "WALLET",
    openingBalance: { amount: "0", currency: "COP" },
  });
  await post(page, `${space}/accounts/${old.id}/archive`, {});
  const { items: groups } = await (await page.request.get(`${space}/categories`)).json();
  const categoryId: string = groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id;
  await post(
    page,
    `${space}/expenses`,
    {
      description: "Market",
      date: "2026-10-31",
      occurredAt: "2026-10-31T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId,
      amount: { amount: "8500000", currency: "COP" },
      accountId: account.id,
    },
    { "idempotency-key": crypto.randomUUID() },
  );
};

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`accessibility in ${colorScheme} (UI Definition of Done)`, () => {
    test.use({ colorScheme });

    test("every M6a screen and sheet has no WCAG 2.1 AA violation", async ({ page }) => {
      const scan = async (where: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        ).toEqual([]);
      };
      for (const path of ["/sign-in?expired=1", "/sign-up"]) {
        await page.goto(path);
        await scan(path);
      }
      await page.goto("/sign-in");
      await page.getByRole("button", { name: es.auth.signIn.forgot }).click();
      await expect(page.getByText(es.auth.signIn.forgotHelp)).toBeVisible();
      await scan("sign-in with the forgotten-password note");

      // A space with no accounts: the home shows the first-account card instead of the summary (P148).
      const spaceId = await signUp(page, colorScheme);
      await page.goto(`/spaces/${spaceId}`);
      await expect(page.getByText(es.home.firstAccount.title)).toBeVisible();
      await scan("home of a space without accounts");
      await page.getByRole("button", { name: es.shell.space.current.replace("{name}", "Personal") }).click();
      await scan("space sheet");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: es.shell.profile.open.replace("{name}", "Ana") }).click();
      await scan("profile sheet");
      await page.keyboard.press("Escape");

      await seedLedger(page, spaceId);
      for (const path of [
        `/spaces/${spaceId}`,
        `/spaces/${spaceId}/transactions`,
        `/spaces/${spaceId}/accounts`,
        `/spaces/${spaceId}/accounts/new`,
        `/spaces/${spaceId}/new`,
        "/settings",
      ]) {
        await page.goto(path);
        await scan(path);
      }
      await page.goto(`/spaces/${spaceId}/accounts`);
      await expect(
        page.getByRole("button", { name: es.accounts.restore.replace("{name}", "Old wallet") }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: es.accounts.archive.open.replace("{name}", "Bancolombia") })
        .click();
      await scan("archive confirmation");
      await page.keyboard.press("Escape");
      await page.goto(`/spaces/${spaceId}/new`);
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await page.getByTestId("when-chip").click();
      await scan("date and time sheet");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: /Categoría/ }).click();
      await scan("category picker");
    });
  });
}

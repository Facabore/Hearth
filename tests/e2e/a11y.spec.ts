import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { seedLedger, signUp } from "./support/seed";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

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
      const spaceId = await signUp(
        page,
        "a11y-" + colorScheme,
        colorScheme === "light" ? "10.252.0.1" : "10.252.0.2",
      );
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
        // N1: the app's own not-found page, for an address and for a space.
        "/nope",
        "/spaces/does-not-exist/accounts",
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

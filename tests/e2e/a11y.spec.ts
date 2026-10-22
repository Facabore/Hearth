import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { saveIncomeFromForm, seedLedger, signUp } from "./support/seed";

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
      // U4: the accounts screen of a person with no accounts is an empty state with its action.
      await page.goto(`/spaces/${spaceId}/accounts`);
      await expect(page.getByRole("heading", { name: es.accounts.empty.title })).toBeVisible();
      await scan("accounts screen without accounts");
      await page.goto(`/spaces/${spaceId}`);
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
        // HU-E9-10: the Plan tab of a space with spending and no plan (Unbudgeted alone).
        `/spaces/${spaceId}/plan`,
        "/settings",
        // N1: the app's own not-found page, for an address and for a space.
        "/nope",
        "/spaces/does-not-exist/accounts",
      ]) {
        await page.goto(path);
        await scan(path);
      }
      // Ruling P189: a transaction's detail opens over the list from a row.
      await page.goto(`/spaces/${spaceId}/transactions`);
      await page.getByRole("link", { name: /Market/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("button", { name: es.ledger.detail.delete })).toBeVisible();
      await scan("transaction detail sheet");
      await page.keyboard.press("Escape");
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

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`the save toast in ${colorScheme} (P195)`, () => {
    test.use({ colorScheme });

    test("has no WCAG 2.1 AA violation while it shows a saved income", async ({ page }) => {
      const spaceId = await signUp(
        page,
        "toast-" + colorScheme,
        colorScheme === "light" ? "10.252.0.3" : "10.252.0.4",
      );
      await seedLedger(page, spaceId);
      await saveIncomeFromForm(page, spaceId);
      await expect(page.getByRole("region", { name: es.toast.region }).getByRole("status")).toContainText(
        es.ledger.toast.saved.INCOME,
      );
      await page.getByTestId("toast").hover();
      const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
      expect(
        violations.map((v) => `toast: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
      ).toEqual([]);
    });
  });
}

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { archiveStarterAccounts, saveIncomeFromForm, seedLedger, signUp } from "./support/seed";

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

      // A space with no active account: the home shows the first-account card instead of the summary (P148). Sign-up
      // opens the starter accounts (issue 169), so this person archived them.
      const spaceId = await signUp(
        page,
        "a11y-" + colorScheme,
        colorScheme === "light" ? "10.252.0.1" : "10.252.0.2",
      );
      await archiveStarterAccounts(page, spaceId);
      await page.goto(`/spaces/${spaceId}`);
      await expect(page.getByText(es.home.firstAccount.title)).toBeVisible();
      await scan("home of a space without accounts");
      // U4: the accounts screen of a person with no active account is an empty state with its actions, the starter
      // accounts among them (issue 169).
      await page.goto(`/spaces/${spaceId}/accounts`);
      await expect(page.getByRole("heading", { name: es.accounts.empty.noActiveTitle })).toBeVisible();
      await expect(page.getByRole("button", { name: es.accounts.empty.starter })).toBeVisible();
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
        // HU-E9-04: the seeded category tree.
        `/spaces/${spaceId}/categories`,
        // HU-E9-11, ruling P267: Mi consumo, the stacked screen with consumption and cash out.
        `/spaces/${spaceId}/my-consumption`,
        // HU-E9-10: the Plan tab's Rubros, a space with spending and no plan (Unbudgeted alone).
        `/spaces/${spaceId}/plan`,
        // HU-E9-11: its By group view, the person's own spending merged across spaces.
        `/spaces/${spaceId}/plan/groups`,
        "/settings",
        // N1: the app's own not-found page, for an address and for a space.
        "/nope",
        "/spaces/does-not-exist/accounts",
      ]) {
        await page.goto(path);
        await scan(path);
      }
      // HU-E9-04: a category's edit sheet (icon picker, color row) and the icon library over it.
      await page.goto(`/spaces/${spaceId}/categories`);
      await page.getByRole("button", { name: es.categories.edit.replace("{name}", "Arriendo") }).click();
      await expect(page.getByRole("radiogroup", { name: es.categories.colorLabel })).toBeVisible();
      await scan("category edit sheet");
      await page.getByRole("button", { name: es.categories.icons.seeAll }).click();
      await expect(page.getByRole("dialog", { name: es.categories.icons.library })).toBeVisible();
      await scan("icon library");
      // Ruling P189: a transaction's detail opens over the list from a row.
      await page.goto(`/spaces/${spaceId}/transactions`);
      await page.getByRole("link", { name: /Market/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(page.getByRole("button", { name: es.ledger.detail.delete })).toBeVisible();
      await scan("transaction detail sheet");
      // Ruling P191: Editar opens the record form on that transaction.
      await page.getByRole("link", { name: es.ledger.detail.edit }).click();
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await expect(page.getByRole("heading", { name: es.ledger.edit.title })).toBeVisible();
      await scan("edit a transaction");
      await page.goto(`/spaces/${spaceId}/accounts`);
      await expect(
        page.getByRole("button", { name: es.accounts.restore.replace("{name}", "Old wallet") }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: es.accounts.archive.open.replace("{name}", "Bancolombia") })
        .click();
      await scan("archive confirmation");
      await page.keyboard.press("Escape");
      // Issue 169: a row opens its account's edit screen.
      await page.getByRole("link", { name: new RegExp(`^Bancolombia.*${es.accounts.edit.action}$`) }).click();
      await expect(page.getByRole("heading", { name: es.accounts.edit.title })).toBeVisible();
      await scan("edit an account");
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

    test("has no WCAG 2.1 AA violation while it offers Deshacer after a delete, and after a failed undo", async ({
      page,
    }) => {
      const spaceId = await signUp(
        page,
        "undo-" + colorScheme,
        colorScheme === "light" ? "10.252.0.5" : "10.252.0.6",
      );
      await seedLedger(page, spaceId);
      const scan = async (where: string) => {
        await page.getByTestId("toast").hover();
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        ).toEqual([]);
      };
      await page.goto(`/spaces/${spaceId}/transactions`);
      await page.getByRole("link", { name: /Market/ }).click();
      await page.getByRole("button", { name: es.ledger.detail.delete }).click();
      const region = page.getByRole("region", { name: es.toast.region });
      await expect(region.getByRole("status")).toContainText(es.ledger.toast.deleted.EXPENSE);
      await scan("toast with Deshacer");
      // The undo is refused (a closed period): the failure shows in the alert region.
      await page.route("**/restore", (route) =>
        route.fulfill({
          status: 409,
          contentType: "application/problem+json",
          body: JSON.stringify({
            type: "urn:hearth:problem:PeriodClosed",
            title: "",
            status: 409,
            code: "PeriodClosed",
          }),
        }),
      );
      await region.getByRole("button", { name: es.ledger.toast.undo }).click();
      await expect(region.getByRole("alert")).toContainText(
        es.ledger.toast.undoFailed.split("{message}")[0]!,
      );
      await scan("toast with a failed undo");
    });
  });
}

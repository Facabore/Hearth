import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import es from "../../src/i18n/messages/es.json" with { type: "json" };
import { get, post, seedLedger, signUp } from "./support/seed";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Ruling P198. The detail sheet of a personal expense, the edit route and the undo toast are scanned in `a11y.spec.ts`
 * with the other M6a screens; this file adds what is only there for a shared expense: the sheet's per-person shares
 * and the edit form's payer and split (HU-E9-06).
 */
for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`a shared expense's detail and edit form in ${colorScheme} (P198)`, () => {
    test.use({ colorScheme });

    test("have no WCAG 2.1 AA violation", async ({ page }) => {
      const scan = async (where: string) => {
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
        expect(
          violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
        ).toEqual([]);
      };
      const personal = await signUp(
        page,
        "a11y-edit-" + colorScheme,
        colorScheme === "light" ? "10.252.0.7" : "10.252.0.8",
      );
      await seedLedger(page, personal);
      const { items: accounts } = await get(page, `/api/v1/spaces/${personal}/accounts`);
      const bank: string = accounts.find((a: { name: string }) => a.name === "Bancolombia").id;
      // A shared space with Ana and the guest Pedro, and one expense split EQUAL between them.
      const household = await post(page, "/api/v1/spaces", {
        kind: "SHARED",
        name: "Household",
        currency: "COP",
      });
      const space = `/api/v1/spaces/${household.id}`;
      await post(page, `${space}/guests`, { displayName: "Pedro" });
      const { items: members } = await get(page, `${space}/members`);
      const [ana, pedro]: string[] = ["Ana", "Pedro"].map(
        (name) => members.find((m: { displayName: string }) => m.displayName === name).id,
      );
      const { items: groups } = await get(page, `${space}/categories`);
      await post(
        page,
        `${space}/expenses`,
        {
          description: "Mercado compartido",
          date: "2026-10-31",
          occurredAt: "2026-10-31T17:00:00.000Z",
          timeZone: "America/Bogota",
          categoryId: groups.flatMap((g: { categories: { id: string }[] }) => g.categories)[0].id,
          amount: { amount: "30000000", currency: "COP" },
          payments: [{ memberId: ana, accountId: bank, amount: { amount: "30000000", currency: "COP" } }],
          split: { method: "EQUAL", participants: [{ memberId: ana }, { memberId: pedro }] },
        },
        { "idempotency-key": crypto.randomUUID() },
      );

      await page.goto(`/spaces/${household.id}/transactions`);
      await page.getByRole("link", { name: /Mercado compartido/ }).click();
      await expect(page.getByRole("dialog", { name: /Mercado compartido/ })).toBeVisible();
      await expect(page.getByRole("link", { name: es.ledger.detail.edit })).toBeVisible();
      await scan("detail sheet of a shared expense");

      await page.getByRole("link", { name: es.ledger.detail.edit }).click();
      await expect(page.locator("[data-ready='true']")).toBeAttached();
      await expect(page.getByRole("heading", { name: es.ledger.edit.title })).toBeVisible();
      await scan("edit a shared expense");
    });
  });
}

import { randomInt } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { test, todayInBogota } from "../support/clock";
import { es } from "../../../src/i18n/messages/full";
import { get, post, signUp } from "../support/seed";
import { sheetsSettled } from "../support/sheets";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

const scan = async (page: Page, where: string) => {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  expect(
    violations.map((v) => `${where}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`),
  ).toEqual([]);
};

const cop = (pesos: number) => ({ amount: String(pesos * 100), currency: "COP" });

test.describe("shared spaces (slice 4 of #199, ADR 0006)", () => {
  test("an invitation joins Juan, a shared expense shows in the balances, and settling up clears it", async ({
    page,
    browser,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const anaPersonal = await signUp(page, "spa-shared-ana", ip);
    const space = (await post(page, "/api/v1/spaces", {
      kind: "SHARED",
      name: "Household",
      currency: "COP",
    })) as {
      id: string;
    };
    const { url } = (await post(page, `/api/v1/spaces/${space.id}/invitations`, {
      kind: "LINK",
      role: "MEMBER",
    })) as {
      url: string;
    };
    const token = new URL(url, "http://hearth.invalid").pathname.split("/").filter(Boolean).at(-1)!;

    // Juan, in a browser of his own: the open invitation page, then accepting it lands in Household (U6).
    const juanContext = await browser.newContext({
      baseURL: test.info().project.use.baseURL,
      extraHTTPHeaders: { "x-forwarded-for": ip },
    });
    const juan = await juanContext.newPage();
    juan.on("pageerror", (error) => errors.push(error.message));
    const juanSignUp = await juan.request.post("/api/v1/auth/sign-up", {
      data: {
        name: "Juan",
        email: `spa-shared-juan-${Date.now()}-${randomInt(1e6)}@example.com`,
        password: "123456789012",
        timezone: "America/Bogota",
      },
      headers: { "x-forwarded-for": ip },
    });
    expect(juanSignUp.ok()).toBe(true);
    await juan.goto(`/invitations/${token}`);
    await expect(juan).toHaveURL(`/invitations/${token}`);
    await scan(juan, "invitation");
    await juan.getByRole("button", { name: "Aceptar y entrar a Household" }).click();
    await expect(juan).toHaveURL(`/spaces/${space.id}?joined=1`);
    await juanContext.close();

    // Ana's members: Juan is one now.
    const { items: members } = (await get(page, `/api/v1/spaces/${space.id}/members`)) as {
      items: { id: string; displayName: string; userId: string | null }[];
    };
    const anaId = members.find((m) => m.displayName === "Ana")!.id;
    const juanId = members.find((m) => m.displayName === "Juan")!.id;
    await page.goto(`/spaces/${space.id}/members`);
    await expect(page.getByRole("heading", { level: 1, name: es.members.title })).toBeVisible();
    await expect(page.getByText(/Ana/).first()).toBeVisible();
    await scan(page, "members");

    // A shared expense of 100,000 COP that Ana paid from her own account, half each.
    const account = (await post(page, `/api/v1/spaces/${anaPersonal}/accounts`, {
      name: "Bancolombia",
      type: "BANK",
      openingBalance: cop(1_000_000),
    })) as { id: string };
    const { items: groups } = (await get(page, `/api/v1/spaces/${space.id}/categories`)) as {
      items: { categories: { id: string }[] }[];
    };
    await post(
      page,
      `/api/v1/spaces/${space.id}/expenses`,
      {
        description: "Mercado",
        date: todayInBogota(),
        categoryId: groups.flatMap((g) => g.categories)[0]!.id,
        amount: cop(100_000),
        payments: [{ memberId: anaId, accountId: account.id, amount: cop(100_000) }],
        split: {
          method: "EXACT",
          participants: [
            { memberId: anaId, amount: cop(50_000) },
            { memberId: juanId, amount: cop(50_000) },
          ],
        },
      },
      { "idempotency-key": crypto.randomUUID() },
    );

    // The balances suggest Juan pays Ana 50,000; recording it clears the suggestion.
    await page.goto(`/spaces/${space.id}/balances`);
    const suggestion = page.getByRole("button", { name: /Juan le paga/ });
    await expect(suggestion).toBeVisible();
    await scan(page, "balances");
    await suggestion.click();
    const dialog = page.getByRole("dialog", { name: "Saldar" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Guardar pago" }).click();
    await expect(suggestion).toHaveCount(0);
    await expect(dialog).toBeHidden();
    await sheetsSettled(page);

    // Juan's history in the period.
    await page.goto(`/spaces/${space.id}/members/${juanId}/history`);
    await expect(page.getByRole("heading", { name: /Juan/ })).toBeVisible();
    await scan(page, "history");

    expect(errors).toEqual([]);
  });

  test("a fund is created as one and fed from the person's own account, never as an income (P320, P321)", async ({
    page,
  }) => {
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
    const personal = await signUp(page, "spa-fund-ana", ip);
    await post(page, `/api/v1/spaces/${personal}/accounts`, {
      name: "Bancolombia",
      type: "BANK",
      openingBalance: cop(1_000_000),
    });
    const space = (await post(page, "/api/v1/spaces", {
      kind: "SHARED",
      name: "Household",
      currency: "COP",
    })) as {
      id: string;
    };

    // P321: Registrar offers the expense and a contribution to the fund, never an income, even before a fund exists;
    // Hacia then offers to create the fund and comes back to the transfer with the amount typed.
    await page.goto(`/spaces/${space.id}/new`);
    await expect(page.getByRole("tab", { name: es.ledger.type.INCOME })).toHaveCount(0);
    await page.getByRole("tab", { name: es.ledger.type.TRANSFER }).click();
    await page.getByLabel(es.ledger.form.amount).pressSequentially("100000");
    await page.getByRole("button", { name: /Hacia/ }).click();
    await page
      .getByRole("dialog", { name: es.ledger.form.to })
      .getByRole("link", { name: es.accounts.createFund })
      .click();

    // P320: a shared space's form creates only a fund, with no type to pick.
    const sheet = page.getByRole("dialog", { name: es.accounts.newFund });
    await expect(sheet.getByRole("radiogroup")).toHaveCount(0);
    await sheet.getByLabel(es.accounts.field.name).fill("Fondo Hogar");
    await sheet.getByRole("button", { name: es.accounts.create }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `/spaces/${space.id}/new` && url.searchParams.get("type") === "transfer",
    );
    await expect(page.getByLabel(es.ledger.form.amount)).toHaveValue("100.000");
    // Desde offers her own accounts (her starter accounts and Bancolombia), never the fund.
    await page.getByRole("button", { name: /Desde/ }).click();
    const from = page.getByRole("dialog", { name: es.ledger.form.from });
    await expect(from.getByRole("radio", { name: /Fondo Hogar/ })).toHaveCount(0);
    await from.getByRole("radio", { name: /Bancolombia/ }).click();
    await expect(page.getByRole("button", { name: /Desde/ })).toContainText("Bancolombia");
    await expect(page.getByRole("button", { name: /Hacia/ })).toContainText("Fondo Hogar");
    await page.getByRole("button", { name: es.ledger.form.save.TRANSFER }).click();
    await expect(page).not.toHaveURL(/\/new/);

    const { items } = (await get(page, `/api/v1/spaces/${space.id}/accounts`)) as {
      items: { name: string; balance: { amount: string } }[];
    };
    expect(items.find((a) => a.name === "Fondo Hogar")?.balance.amount).toBe(cop(100_000).amount);
  });
});

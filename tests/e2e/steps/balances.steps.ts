import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";
import { minor, shown } from "../support/money";

const norm = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
const cop = (pesos: string) => ({ amount: minor(pesos), currency: "COP" });

Given(
  /^in "([^"]+)" the net balances are "([^"]+)" \+([\d,]+) COP, "([^"]+)" -([\d,]+) COP and "([^"]+)" -([\d,]+) COP$/,
  async (
    { page, world },
    space: string,
    owed: string,
    total: string,
    a: string,
    aOwes: string,
    b: string,
    bOwes: string,
  ) => {
    await world.signUp(a);
    const ana = await world.person(owed);
    const luis = await world.person(b);
    const spaceId = await world.sharedSpace(ana, space);
    await world.join(ana, space, "me", "MEMBER");
    await world.join(ana, space, luis, "MEMBER");
    const bank = (await ana.api.post(`/api/v1/spaces/${ana.personalSpaceId}/accounts`, {
      name: "Bancolombia",
      type: "BANK",
      openingBalance: cop("1,000,000"),
    })) as { id: string };
    const [anaId, juanId, luisId] = [
      await world.memberId(space, owed),
      await world.memberId(space, a),
      await world.memberId(space, b),
    ];
    const { items } = (await ana.api.get(`/api/v1/spaces/${spaceId}/categories`)) as {
      items: { categories: { id: string }[] }[];
    };
    await ana.api.post(`/api/v1/spaces/${spaceId}/expenses`, {
      description: "Hotel",
      date: "2026-10-20",
      occurredAt: "2026-10-20T17:00:00.000Z",
      timeZone: "America/Bogota",
      categoryId: items.flatMap((g) => g.categories)[0]!.id,
      amount: cop(total),
      payments: [{ memberId: anaId, accountId: bank.id, amount: cop(total) }],
      split: {
        method: "EXACT",
        participants: [
          { memberId: juanId, amount: cop(aOwes) },
          { memberId: luisId, amount: cop(bOwes) },
        ],
      },
    });
    const { members } = (await world.api.get(`/api/v1/spaces/${spaceId}/balances`)) as {
      members: { memberId: string; net: { amount: string } }[];
    };
    expect(members.map((m) => m.net.amount)).toEqual([minor(total), `-${minor(aOwes)}`, `-${minor(bOwes)}`]);
    await page.clock.setFixedTime(new Date("2026-10-31T17:00:00Z"));
  },
);

When(
  /^"([^"]+)" opens the balances screen and chooses "Settle" on the suggestion "([^"]+) pays ([^"]+) ([\d,]+) COP"$/,
  async ({ page, world }, _n: string, payer: string, receiver: string, pesos: string) => {
    await page.goto(`/spaces/${[...world.spaces.values()][0]}/balances`);
    await page
      .getByRole("button", {
        name: world.t("balances.settle.suggestion", { payer, receiver, amount: shown(pesos) }),
      })
      .click();
  },
);

When("confirms the prefilled settlement form", async ({ page, world }) => {
  const dialog = page.getByRole("dialog", { name: world.t("balances.settle.title") });
  await expect(dialog.getByLabel(world.t("balances.settle.amount"))).toHaveValue("100.000");
  await dialog.getByRole("button", { name: world.t("balances.settle.save") }).click();
  await expect(dialog).toBeHidden();
});

Then(
  /^a settlement of ([\d,]+) COP from "([^"]+)" to "([^"]+)" is listed$/,
  async ({ page, world }, pesos: string, from: string, to: string) => {
    await page.goto(`/spaces/${[...world.spaces.values()][0]}/transactions`);
    const row = page.getByRole("listitem").filter({ hasText: world.t("ledger.settlement", { from, to }) });
    expect(norm(await row.textContent())).toContain(norm(shown(pesos)));
  },
);

Then(/^"([^"]+)" shows a net balance of 0 COP$/, async ({ page, world }, name: string) => {
  await page.goto(`/spaces/${[...world.spaces.values()][0]}/balances`);
  const label = name === world.user!.name ? world.t("members.you", { name }) : name;
  await expect(
    page.getByRole("link", {
      name: world.t("balances.member.link", { name: label, sentence: world.t("balances.member.settled") }),
    }),
  ).toBeVisible();
});

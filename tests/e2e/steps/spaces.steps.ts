import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/fixtures";

const ROLE_KEYS: Record<string, string> = {
  OWNER: "shell.role.OWNER",
  ADMIN: "shell.role.ADMIN",
  MEMBER: "shell.role.MEMBER",
  VIEWER: "shell.role.VIEWER",
  Owner: "shell.role.OWNER",
  Member: "shell.role.MEMBER",
};
let invitation = "";

Given(
  "{string} created a link invitation for {string} with role {string} and copied its URL",
  async ({ world }, name: string, space: string, role: string) => {
    const owner = await world.person(name);
    const spaceId = await world.sharedSpace(owner, space);
    const { url } = (await owner.api.post(`/api/v1/spaces/${spaceId}/invitations`, {
      kind: "LINK",
      role,
    })) as { url: string };
    invitation = new URL(url).pathname;
  },
);

When("a visitor without an account opens the URL", async ({ page }) => {
  await page.goto(invitation);
});

Then(
  "the invitation page shows the space {string} and the role {string}",
  async ({ page, world }, space: string, role: string) => {
    await expect(page.getByRole("heading", { level: 1, name: space })).toBeVisible();
    await expect(page.getByText(world.t("invitation.role"))).toBeVisible();
    await expect(page.getByText(world.t(ROLE_KEYS[role]!), { exact: true })).toBeVisible();
  },
);

When("the visitor signs up as {string}", async ({ page, world }, email: string) => {
  await page.getByRole("link", { name: world.t("invitation.signUp") }).click();
  const name = email.split("@")[0]!.replace(/^./, (c) => c.toUpperCase());
  await page.getByLabel(world.t("auth.signUp.name")).fill(name);
  await page.getByLabel(world.t("auth.email")).fill(world.email(email));
  await page.getByLabel(world.t("auth.password"), { exact: true }).fill("123456789012");
  await page.getByLabel(world.t("auth.signUp.confirmPassword"), { exact: true }).fill("123456789012");
  await page.getByRole("button", { name: world.t("auth.signUp.submit") }).click();
});

Then("the visitor is returned to the invitation and accepts it", async ({ page, world }) => {
  await expect(page).toHaveURL(invitation);
  const space = [...world.spaces.keys()][0]!;
  await page.getByRole("button", { name: world.t("invitation.accept", { space }) }).click();
  // U6: accepting lands on the space with a one-time welcome, not a silent jump.
  await expect(page).toHaveURL(`/spaces/${world.spaces.get(space)}?joined=1`);
});

Then(
  "the members screen of {string} lists {string} as {string}",
  async ({ page, world }, space: string, name: string, role: string) => {
    await page.goto(`/spaces/${world.spaces.get(space)}/members`);
    const row = page.getByRole("listitem", { name: new RegExp(`^${name}`) });
    await expect(row).toContainText(world.t(ROLE_KEYS[role]!));
  },
);

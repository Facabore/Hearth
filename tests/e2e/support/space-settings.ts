import { expect, type Page } from "@playwright/test";
import type { World } from "./world";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A catalog message with `{name}` as any name: the active space's, whatever the person called it. */
const anyName = (world: World, key: string) => {
  const [before = "", after = ""] = world.t(key, { name: "\u0000" }).split("\u0000");
  return new RegExp(`^${escaped(before)}.+${escaped(after)}$`);
};

/** Ruling P311 (amends P309): a space's Configuración, from the ⚙ in the header of every tab. */
export async function openSpaceSettings(page: Page, world: World): Promise<void> {
  await page
    .getByRole("banner")
    .getByRole("link", { name: anyName(world, "shell.settings") })
    .click();
  await expect(page).toHaveURL(/\/spaces\/[^/]+\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: world.t("spaces.screen.title") })).toBeVisible();
}

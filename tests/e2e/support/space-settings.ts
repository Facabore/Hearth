import { expect, type Page } from "@playwright/test";
import type { World } from "./world";

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A catalog message with `{name}` as any name: the active space's, whatever the person called it. */
const anyName = (world: World, key: string) => {
  const [before = "", after = ""] = world.t(key, { name: "\u0000" }).split("\u0000");
  return new RegExp(`^${escaped(before)}.+${escaped(after)}$`);
};

/** Ruling P309: a space's own settings, from the space switcher's "Ajustes de {space}". */
export async function openSpaceSettings(page: Page, world: World): Promise<void> {
  await page.getByRole("button", { name: anyName(world, "shell.space.current") }).click();
  await page.getByRole("link", { name: anyName(world, "shell.space.settings") }).click();
  await expect(page).toHaveURL(/\/spaces\/[^/]+\/settings$/);
}

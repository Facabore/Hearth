import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Load } from "../load";
import { daysOf, loadCapacities, windowOf } from "./loaders";

const sheet = vi.hoisted(() => ({ preload: vi.fn<() => Promise<void>>() }));
vi.mock("@/shared/ui/molecules/sheet", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  preloadSheet: sheet.preload,
}));

describe("the Plan tab's query string (P219, P241 of M6c)", () => {
  it("reads the trend's window: twelve periods when `?periods=12` asks for them, else six", () => {
    expect([windowOf(undefined), windowOf("12"), windowOf("7")]).toEqual([6, 12, 6]);
  });

  it("reads Próximos' window: 60 days when `?days=60` asks for them, else 30", () => {
    expect([daysOf(undefined), daysOf("60"), daysOf("90")]).toEqual([30, 60, 30]);
  });
});

describe("the capacities' loader (HU-E9-08, board 04)", () => {
  it("loads the sheet's own code beside the planner's reads, so the sheet paints with the screen's first frame", async () => {
    let codeIn!: () => void;
    sheet.preload.mockReturnValue(new Promise<void>((resolve) => (codeIn = resolve)));
    const queryClient = new QueryClient();
    const reads = vi.spyOn(queryClient, "ensureQueryData").mockResolvedValue(null);
    let loaded = false;
    const loading = loadCapacities(
      { queryClient, apis: { api: {} }, cause: "enter" } as unknown as Load,
      "sp-household",
      "p-nov",
    ).then(() => {
      loaded = true;
    });
    // The plan, the members, the categories and the suggestion, all asked for while the sheet's code downloads.
    await vi.waitFor(() => expect(reads).toHaveBeenCalledTimes(4));
    expect(sheet.preload).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loaded).toBe(false);
    codeIn();
    await loading;
    expect(loaded).toBe(true);
  });
});

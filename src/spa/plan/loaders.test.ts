import { describe, expect, it } from "vitest";
import { daysOf, windowOf } from "./loaders";

describe("the Plan tab's query string (P219, P241 of M6c)", () => {
  it("reads the trend's window: twelve periods when `?periods=12` asks for them, else six", () => {
    expect([windowOf(undefined), windowOf("12"), windowOf("7")]).toEqual([6, 12, 6]);
  });

  it("reads Próximos' window: 60 days when `?days=60` asks for them, else 30", () => {
    expect([daysOf(undefined), daysOf("60"), daysOf("90")]).toEqual([30, 60, 30]);
  });
});

import { describe, expect, it } from "vitest";
import { ACCOUNT_COLORS, ACCOUNT_ICONS } from "../application";
import { attributesFromBody, CreateAccountBodySchema, UpdateAccountBodySchema } from "./accounts.contract";

const base = { name: "Nequi", type: "WALLET", openingBalance: { amount: "0", currency: "COP" } };
const create = (attributes: Record<string, unknown>) =>
  CreateAccountBodySchema.safeParse({ ...base, ...attributes });
const update = (attributes: Record<string, unknown>) => UpdateAccountBodySchema.safeParse(attributes);

/** HU-E2-05, ruling P50: the contract is where these rules are enforced, so none may reach PostgreSQL. */
const refused: readonly [string, unknown][] = [
  ["institution", ""],
  ["institution", "   "],
  ["institution", "x".repeat(61)],
  ["institution", 42],
  ["lastFour", "123"],
  ["lastFour", "12345"],
  ["lastFour", "12a4"],
  ["lastFour", " 4821"],
  ["lastFour", "4821\n"],
  ["lastFour", "4111111111111111"],
  // Only ASCII digits: PostgreSQL checks `^[0-9]{4}$`, so a Unicode digit would answer 500 if it got through.
  ["lastFour", "٤٨٢١"], // Arabic-Indic
  ["lastFour", "４８２１"], // fullwidth
  ["lastFour", 4821],
  ["color", "purple"],
  ["color", "Pine"],
  ["color", ""],
  ["icon", "rocket"],
  ["icon", "Wallet"],
  ["icon", ""],
];

describe("account attributes in the HTTP contract (HU-E2-05)", () => {
  it.each(refused)("refuses %s = %j when creating", (field, value) => {
    expect(create({ [field]: value }).success).toBe(false);
  });

  it.each(refused)("refuses %s = %j when updating", (field, value) => {
    expect(update({ [field]: value }).success).toBe(false);
  });

  it("accepts the edges of each rule", () => {
    const parsed = create({
      institution: "x".repeat(60),
      lastFour: "0000",
      color: "rose",
      icon: "smartphone",
    });
    expect(parsed.success).toBe(true);
    expect(create({ institution: "N" }).success).toBe(true);
  });

  it("accepts every palette key and every allow-listed icon", () => {
    for (const color of ACCOUNT_COLORS) expect(create({ color }).success).toBe(true);
    for (const icon of ACCOUNT_ICONS) expect(create({ icon }).success).toBe(true);
  });

  it("trims the institution before checking its length", () => {
    expect(create({ institution: "  Nequi  " }).data?.institution).toBe("Nequi");
    expect(create({ institution: `  ${"x".repeat(60)}  ` }).success).toBe(true);
  });

  it("clears an attribute with null only when updating", () => {
    const clear = { institution: null, lastFour: null, color: null, icon: null };
    expect(update(clear).data).toEqual(clear);
    for (const field of Object.keys(clear)) expect(create({ [field]: null }).success).toBe(false);
  });

  it("hands the four attributes to the use cases, keeping left out ones undefined and cleared ones null", () => {
    expect(
      attributesFromBody({ institution: "Nequi", lastFour: "4821", color: "pine", icon: "wallet" }),
    ).toEqual({
      institution: "Nequi",
      lastFour: "4821",
      color: "pine",
      icon: "wallet",
    });
    expect(attributesFromBody({})).toEqual({
      institution: undefined,
      lastFour: undefined,
      color: undefined,
      icon: undefined,
    });
    expect(attributesFromBody({ color: null, icon: null })).toMatchObject({ color: null, icon: null });
  });
});

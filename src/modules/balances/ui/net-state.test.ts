import { describe, expect, it } from "vitest";
import { cop } from "../../../../tests/support/ui/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { absolute, memberSentence, netState } from "./net-state";

const t = (key: string, values: { amount: string }) =>
  ({
    "member.owes": `debe ${values.amount}`,
    "member.owed": `le deben ${values.amount}`,
    "member.settled": "a paz y salvo",
  })[key]!;
const norm = (text: string) => text.replace(/\s/g, " ");

describe("net balances as sentences (HU-E9-07, ruling P173)", () => {
  it("reads a negative net as owing, a positive one as owed and zero as settled, never by its sign", () => {
    expect([netState(cop(-100_000)), netState(cop(150_000)), netState(cop(0))]).toEqual([
      "owes",
      "owed",
      "settled",
    ]);
    expect(absolute(cop(-100_000))).toEqual(cop(100_000));
    expect(norm(memberSentence(cop(-100_000), BUILT_IN_FORMATS, t))).toBe("debe $ 100.000");
    expect(norm(memberSentence(cop(150_000), BUILT_IN_FORMATS, t))).toBe("le deben $ 150.000");
    expect(memberSentence(cop(0), BUILT_IN_FORMATS, t)).toBe("a paz y salvo");
  });
});

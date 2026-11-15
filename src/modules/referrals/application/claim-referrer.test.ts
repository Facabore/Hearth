import { describe, expect, it } from "vitest";
import type { Result } from "@/shared/kernel";
import { HOUR, REFERRALS_NOW, referralsWorld } from "../../../../tests/support/in-memory-referrals";
import { createClaimReferrer, createPreviewReferral } from "./claim-referrer";
import { createGetMyReferrals } from "./get-my-referrals";

const setUp = async () => {
  const w = referralsWorld();
  const fabian = w.person("u-fabian", "Fabián Bonilla", new Date("2026-01-01T00:00:00Z"));
  const mine = createGetMyReferrals(w.deps);
  const codeOf = async (id: string, name: string) => {
    const result = await mine({ user: w.person(id, name, new Date("2026-01-01T00:00:00Z")) });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.code;
  };
  const code = await codeOf(fabian.id, fabian.name);
  return {
    w,
    fabian,
    code,
    codeOf,
    preview: createPreviewReferral(w.deps),
    claim: createClaimReferrer(w.deps),
  };
};
const outcome = (result: Result<unknown>) => (result.ok ? "ok" : result.error.code);

describe("a link's preview (D27)", () => {
  it("answers only the referrer's first name, for the code typed in any case", async () => {
    const { preview, code } = await setUp();
    expect(await preview({ code: code.toUpperCase() })).toEqual({ ok: true, value: { firstName: "Fabián" } });
  });

  it("answers ReferralCodeNotFound alike for an unknown code and a malformed one", async () => {
    const { preview } = await setUp();
    for (const code of ["fabian-a3b4c5d6", "nope", "../../me", ""])
      expect(await preview({ code })).toEqual({ ok: false, error: { code: "ReferralCodeNotFound" } });
  });
});

describe("claiming a referrer (D27)", () => {
  it("records the code's owner as the new account's referrer, once, and the same claim again is ok", async () => {
    const { w, claim, code } = await setUp();
    const ana = w.person("u-ana", "Ana");
    expect(await claim({ user: ana, code })).toEqual({ ok: true, value: undefined });
    expect(await claim({ user: ana, code })).toEqual({ ok: true, value: undefined });
    expect([...w.referrals]).toEqual([["u-ana", { referrerId: "u-fabian", createdAt: REFERRALS_NOW }]]);
  });

  it("refuses the person's own code with OwnReferralCode and stores nothing", async () => {
    const { w, claim, fabian, code } = await setUp();
    expect(outcome(await claim({ user: fabian, code }))).toBe("OwnReferralCode");
    expect(w.referrals.size).toBe(0);
  });

  it("refuses an account 24 hours old or older with ReferralWindowClosed and stores nothing", async () => {
    const { w, claim, code } = await setUp();
    const old = w.person("u-old", "Luis", new Date(REFERRALS_NOW.getTime() - 24 * HOUR));
    const almost = w.person("u-almost", "Eva", new Date(REFERRALS_NOW.getTime() - 24 * HOUR + 1));
    expect(outcome(await claim({ user: old, code }))).toBe("ReferralWindowClosed");
    expect(w.referrals.has("u-old")).toBe(false);
    expect(outcome(await claim({ user: almost, code }))).toBe("ok");
  });

  it("refuses a second referrer with AlreadyReferred and keeps the first", async () => {
    const { w, claim, code, codeOf } = await setUp();
    const other = await codeOf("u-roger", "Roger");
    const ana = w.person("u-ana", "Ana");
    await claim({ user: ana, code });
    expect(outcome(await claim({ user: ana, code: other }))).toBe("AlreadyReferred");
    expect(w.referrals.get("u-ana")?.referrerId).toBe("u-fabian");
  });

  it("answers AlreadyReferred when a concurrent claim stored another referrer first", async () => {
    const { w, code } = await setUp();
    const ana = w.person("u-ana", "Ana");
    // The other claim lands between this claim's check and its write.
    const claim = createClaimReferrer({
      ...w.deps,
      referrals: {
        ...w.deps.referrals,
        add: (referral) => w.deps.referrals.add({ ...referral, referrerId: "u-roger" }),
      },
    });
    expect(outcome(await claim({ user: ana, code }))).toBe("AlreadyReferred");
  });

  it("refuses an unknown or malformed code with ReferralCodeNotFound and stores nothing", async () => {
    const { w, claim } = await setUp();
    const ana = w.person("u-ana", "Ana");
    for (const code of ["fabian-a3b4c5d6", "fabian"])
      expect(outcome(await claim({ user: ana, code }))).toBe("ReferralCodeNotFound");
    expect(w.referrals.size).toBe(0);
  });
});

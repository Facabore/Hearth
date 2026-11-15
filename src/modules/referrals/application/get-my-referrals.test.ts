import { describe, expect, it } from "vitest";
import { referralsWorld } from "../../../../tests/support/in-memory-referrals";
import { createGetMyReferrals } from "./get-my-referrals";

describe("a person's referral code (D27)", () => {
  it("is created on the first read, with a readable prefix, and stays the same afterwards", async () => {
    const w = referralsWorld();
    const mine = createGetMyReferrals(w.deps);
    const fabian = w.person("u-fabian", "Fabián Bonilla");
    expect(await mine({ user: fabian })).toEqual({
      ok: true,
      value: { code: "fabian-7k2qx9mt", link: "https://hearth.test/r/fabian-7k2qx9mt", points: 0, items: [] },
    });
    expect(await mine({ user: fabian })).toMatchObject({ ok: true, value: { code: "fabian-7k2qx9mt" } });
    expect([...w.codes.values()]).toEqual(["fabian-7k2qx9mt"]);
  });

  it("draws another random part when the code is someone else's", async () => {
    const w = referralsWorld(["7k2qx9mt", "7k2qx9mt", "a3b4c5d6"]);
    const mine = createGetMyReferrals(w.deps);
    expect(await mine({ user: w.person("u-ana", "Ana") })).toMatchObject({ value: { code: "ana-7k2qx9mt" } });
    expect(await mine({ user: w.person("u-ana2", "Ana") })).toMatchObject({
      value: { code: "ana-a3b4c5d6" },
    });
  });
});

describe("the referrer's list and points (D27)", () => {
  it("counts a point only for referrals whose email is verified, lists first names and join days, newest first", async () => {
    const w = referralsWorld();
    const mine = createGetMyReferrals(w.deps);
    const fabian = w.person("u-fabian", "Fabián");
    // 02:00 UTC on the 12th is still the 11th in Bogotá: the day is the referrer's.
    w.person("u-andres", "Andrés Gómez", new Date("2026-11-12T02:00:00Z"));
    w.person("u-roger", "Roger", new Date("2026-11-14T13:00:00Z"));
    for (const referredId of ["u-andres", "u-roger"])
      await w.deps.referrals.add({ referrerId: fabian.id, referredId, createdAt: new Date() });
    w.verify("u-andres");
    const result = await mine({ user: fabian });
    expect(result).toEqual({
      ok: true,
      value: {
        code: "fabian-7k2qx9mt",
        link: "https://hearth.test/r/fabian-7k2qx9mt",
        points: 1,
        items: [
          { firstName: "Roger", joinedOn: "2026-11-14", counts: false },
          { firstName: "Andrés", joinedOn: "2026-11-11", counts: true },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/u-andres|u-roger|@example\.com/);
  });
});

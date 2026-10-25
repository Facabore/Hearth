import { describe, expect, it } from "vitest";
import { splitShares, type SplitInput } from "@/modules/ledger/domain/split";
import { Money } from "@/shared/kernel";
import {
  allocateMinor,
  equalPercents,
  previewSplit,
  remainingPercent,
  type ParticipantValue,
  type ShareMethod,
} from "./split-math";

const JOIN_ORDER = ["m-ana", "m-juan", "m-luis"];
const preview = (method: ShareMethod, amount: string, participants: ParticipantValue[]) =>
  previewSplit({ method, amount, currency: "COP", numberFormat: "DOT_COMMA", participants });

/** The domain's split of the same request, as { memberId: minor units }. */
const server = (amount: string, split: SplitInput) => {
  const money = Money.ofMinor(BigInt(amount), "COP");
  if (!money.ok) throw new Error("bad amount");
  const shares = splitShares(money.value, split, JOIN_ORDER);
  return shares.ok
    ? Object.fromEntries(shares.value.map((s) => [s.memberId, String(s.amount)]))
    : shares.error.code;
};
const ours = (check: ReturnType<typeof preview>) =>
  check.ok ? Object.fromEntries(check.shares.map((s) => [s.memberId, s.amount])) : check.reason;
const inJoinOrder = (ids: string[]) => JOIN_ORDER.filter((id) => ids.includes(id));

describe("previewSplit equals the server's splitShares (HU-E9-06, ruling P166)", () => {
  it.each([
    [
      "EQUAL 300,000 among three",
      "30000000",
      "EQUAL",
      [
        ["m-ana", ""],
        ["m-juan", ""],
        ["m-luis", ""],
      ],
    ],
    [
      "EQUAL 100,000.01 between two: the cent stays with the first",
      "10000001",
      "EQUAL",
      [
        ["m-ana", ""],
        ["m-juan", ""],
      ],
    ],
    [
      "EQUAL 100,000 among three: the leftover peso to the first",
      "10000000",
      "EQUAL",
      [
        ["m-ana", ""],
        ["m-juan", ""],
        ["m-luis", ""],
      ],
    ],
    [
      "PERCENT 33.33 / 33.33 / 33.34",
      "10000000",
      "PERCENT",
      [
        ["m-ana", "33,33"],
        ["m-juan", "33,33"],
        ["m-luis", "33,34"],
      ],
    ],
    [
      "PERCENT 40 / 60 chosen in reverse order",
      "30000000",
      "PERCENT",
      [
        ["m-juan", "60"],
        ["m-ana", "40"],
      ],
    ],
    [
      "SHARES 2 / 1 / 1 of 90,000",
      "9000000",
      "SHARES",
      [
        ["m-ana", "2"],
        ["m-juan", "1"],
        ["m-luis", "1"],
      ],
    ],
    [
      "EXACT 100,000 / 150,000 of 250,000",
      "25000000",
      "EXACT",
      [
        ["m-ana", "100.000"],
        ["m-juan", "150.000"],
      ],
    ],
  ] as const)("%s", (_, amount, method, rows) => {
    const participants = rows.map(([memberId, value]) => ({ memberId, value }));
    const ordered = inJoinOrder(participants.map((p) => p.memberId)).map((id) =>
      participants.find((p) => p.memberId === id)!,
    );
    const split: SplitInput =
      method === "EQUAL"
        ? { method, participants: ordered.map(({ memberId }) => ({ memberId })) }
        : method === "PERCENT"
          ? {
              method,
              participants: ordered.map(({ memberId, value }) => ({
                memberId,
                basisPoints: Math.round(Number(value.replace(",", ".")) * 100),
              })),
            }
          : method === "SHARES"
            ? {
                method,
                participants: ordered.map(({ memberId, value }) => ({ memberId, units: Number(value) })),
              }
            : {
                method,
                participants: ordered.map(({ memberId, value }) => {
                  const money = Money.ofMinor(BigInt(value.replaceAll(".", "")) * 100n, "COP");
                  if (!money.ok) throw new Error("bad");
                  return { memberId, amount: money.value };
                }),
              };
    expect(ours(preview(method, amount, ordered))).toEqual(server(amount, split));
  });

  it("refuses, like the server, an amount too small to give everyone a whole peso", () => {
    expect(
      ours(
        preview("EQUAL", "100", [
          { memberId: "m-ana", value: "" },
          { memberId: "m-juan", value: "" },
        ]),
      ),
    ).toBe("tooSmall");
    expect(
      server("100", { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-juan" }] }),
    ).toBe("InvalidSplit");
  });
});

describe("previewSplit says what an invalid split is missing (ruling P169)", () => {
  it("counts the percent left or over", () => {
    expect(
      preview("PERCENT", "30000000", [
        { memberId: "m-ana", value: "40" },
        { memberId: "m-juan", value: "50" },
      ]),
    ).toEqual({
      ok: false,
      reason: "percentShort",
      percent: "10.00",
    });
    expect(
      preview("PERCENT", "30000000", [
        { memberId: "m-ana", value: "40" },
        { memberId: "m-juan", value: "62,5" },
      ]),
    ).toEqual({
      ok: false,
      reason: "percentOver",
      percent: "2.50",
    });
  });

  it("counts the amount left or over of an EXACT split", () => {
    expect(
      preview("EXACT", "25000000", [
        { memberId: "m-ana", value: "100.000" },
        { memberId: "m-juan", value: "149.999" },
      ]),
    ).toEqual({
      ok: false,
      reason: "exactShort",
      amount: "100",
    });
    expect(
      preview("EXACT", "25000000", [
        { memberId: "m-ana", value: "100.000" },
        { memberId: "m-juan", value: "160.000" },
      ]),
    ).toEqual({
      ok: false,
      reason: "exactOver",
      amount: "1000000",
    });
  });

  it("names the participant whose value cannot be read, and asks for someone", () => {
    expect(
      preview("SHARES", "9000000", [
        { memberId: "m-ana", value: "2" },
        { memberId: "m-juan", value: "0" },
      ]),
    ).toEqual({
      ok: false,
      reason: "unreadable",
      memberId: "m-juan",
    });
    expect(preview("PERCENT", "9000000", [{ memberId: "m-ana", value: "33,333" }])).toMatchObject({
      reason: "unreadable",
    });
    expect(preview("EQUAL", "9000000", [])).toEqual({ ok: false, reason: "noParticipants" });
  });

  it("allocates like Money.allocate for a negative amount too", () => {
    expect(allocateMinor(-10000001n, [1n, 1n], 100n)).toEqual([-5000001n, -5000000n]);
  });
});

describe("previewSplit with excluded participants, one participant and large amounts (HU-E9-06)", () => {
  it("splits only among the chosen members, the leftover peso to the earlier-joined one", () => {
    const check = preview("EQUAL", "10000000", [
      { memberId: "m-ana", value: "" },
      { memberId: "m-luis", value: "" },
    ]);
    expect(ours(check)).toEqual({ "m-ana": "5000000", "m-luis": "5000000" });
    expect(ours(check)).toEqual(
      server("10000000", { method: "EQUAL", participants: [{ memberId: "m-ana" }, { memberId: "m-luis" }] }),
    );
  });

  it("gives a single participant the whole amount, the sub-peso units included", () => {
    expect(ours(preview("EQUAL", "10000001", [{ memberId: "m-juan", value: "" }]))).toEqual({
      "m-juan": "10000001",
    });
    expect(ours(preview("SHARES", "10000001", [{ memberId: "m-juan", value: "5" }]))).toEqual({
      "m-juan": "10000001",
    });
  });

  it("keeps every share exact beyond the safe-integer range", () => {
    const amount = "900719925474099312345";
    const rows = [
      ["m-ana", ""],
      ["m-juan", ""],
      ["m-luis", ""],
    ] as const;
    const check = preview(
      "EQUAL",
      amount,
      rows.map(([memberId, value]) => ({ memberId, value })),
    );
    expect(ours(check)).toEqual(
      server(amount, { method: "EQUAL", participants: JOIN_ORDER.map((memberId) => ({ memberId })) }),
    );
    const sum = check.ok ? check.shares.reduce((total, s) => total + BigInt(s.amount), 0n) : -1n;
    expect(sum).toBe(BigInt(amount));
  });

  it("rejects units the server could not read as safe integers", () => {
    expect(preview("SHARES", "9000000", [{ memberId: "m-ana", value: "9007199254740993" }])).toEqual({
      ok: false,
      reason: "unreadable",
      memberId: "m-ana",
    });
  });
});

describe("allocateMinor equals Money.allocate for any weights", () => {
  /** A small deterministic generator, so a failure reproduces. */
  const random = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  it.each([
    ["COP", 100n],
    ["USD", 1n],
  ] as const)("over a seeded sweep in %s", (currency, unit) => {
    const next = random(11);
    for (let round = 0; round < 300; round++) {
      const minor = BigInt(Math.floor(next() * 1e9)) * (next() < 0.2 ? -1n : 1n);
      const weights = Array.from({ length: 1 + Math.floor(next() * 5) }, () =>
        BigInt(1 + Math.floor(next() * 9999)),
      );
      const money = Money.ofMinor(minor, currency);
      if (!money.ok) throw new Error("bad amount");
      const expected = money.value.allocate(weights);
      if (!expected.ok) throw new Error("bad weights");
      expect(allocateMinor(minor, weights, unit)).toEqual(expected.value.map((part) => part.minor));
    }
  });
});

describe("percent helpers (issue #177)", () => {
  it("splits 100 % in equal hundredths with the remainder on the last", () => {
    expect(equalPercents(2)).toEqual(["50", "50"]);
    expect(equalPercents(3)).toEqual(["33.33", "33.33", "33.34"]);
    expect(equalPercents(0)).toEqual([]);
  });

  it("works out the last person's percent from the others, and none past 100 % or with an unreadable one", () => {
    expect(remainingPercent(["40"])).toBe("60");
    expect(remainingPercent(["33.33", "33.33"])).toBe("33.34");
    expect(remainingPercent(["100"])).toBe("0");
    expect(remainingPercent(["70", "40"])).toBeNull();
    expect(remainingPercent(["40", null])).toBeNull();
  });
});

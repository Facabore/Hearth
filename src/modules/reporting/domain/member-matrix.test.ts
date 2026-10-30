import { describe, expect, it } from "vitest";
import { gapStatus, matrixRow, memberTotals, type LineSums } from "./member-matrix";

const pesos = (n: number) => BigInt(n) * 100n;
const member = (memberId: string, assigned: number | null, contributed: number, consumed: number) => ({
  memberId,
  assigned: assigned === null ? null : pesos(assigned),
  contributed: pesos(contributed),
  consumed: pesos(consumed),
});
const line = (overrides: Partial<LineSums>): LineSums => ({
  funding: "DIRECT",
  allocated: true,
  invalid: false,
  members: [],
  ...overrides,
});

describe("member by line matrix (HU-E7-02, spec 5.4)", () => {
  it("gives Home's DIRECT row: assigned, contributed, consumed and gap per member (@golden)", () => {
    const home = line({
      members: [member("ana", 588_000, 900_000, 520_000), member("juan", 882_000, 400_000, 780_000)],
    });
    expect(matrixRow(home)).toEqual({
      reason: null,
      members: [
        {
          memberId: "ana",
          assigned: pesos(588_000),
          contributed: pesos(900_000),
          consumed: pesos(520_000),
          gap: pesos(312_000),
          status: "OVER_CONTRIBUTED",
        },
        {
          memberId: "juan",
          assigned: pesos(882_000),
          contributed: pesos(400_000),
          consumed: pesos(780_000),
          gap: -pesos(482_000),
          status: "UNDER_CONTRIBUTED",
        },
      ],
    });
  });

  it("leaves a SHARED_FUND line's contribution and gap to the fund, keeping its assigned and consumed amounts", () => {
    const rent = line({
      funding: "SHARED_FUND",
      members: [member("ana", 480_000, 0, 480_000), member("juan", 720_000, 0, 720_000)],
    });
    const row = matrixRow(rent);
    expect(row.reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(row.members.map((m) => [m.assigned, m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [pesos(480_000), null, pesos(480_000), null, null],
      [pesos(720_000), null, pesos(720_000), null, null],
    ]);
  });

  it("tracks an invalid SHARED_FUND line at fund level, assigning nobody", () => {
    const row = matrixRow(
      line({ funding: "SHARED_FUND", invalid: true, members: [member("ana", 100_000, 0, 50_000)] }),
    );
    expect(row.reason).toBe("TRACKED_AT_FUND_LEVEL");
    expect(row.members.map((m) => [m.assigned, m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [null, null, pesos(50_000), null, null],
    ]);
  });

  it("reports only consumption on a line without allocation (NONE)", () => {
    const free = line({
      allocated: false,
      members: [member("ana", null, 50_000, 25_000), member("juan", null, 0, 25_000)],
    });
    const row = matrixRow(free);
    expect(row.reason).toBe("NOT_ALLOCATED");
    expect(row.members.map((m) => [m.assigned, m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [null, null, pesos(25_000), null, null],
      [null, null, pesos(25_000), null, null],
    ]);
  });

  it("assigns nobody on an invalid allocation and keeps what each member contributed", () => {
    expect(matrixRow(line({ invalid: true, members: [member("ana", null, 100_000, 50_000)] }))).toEqual({
      reason: "INVALID_ALLOCATION",
      members: [
        {
          memberId: "ana",
          assigned: null,
          contributed: pesos(100_000),
          consumed: pesos(50_000),
          gap: null,
          status: null,
        },
      ],
    });
  });

  it("drops any assigned amount the line carries when its allocation is invalid or absent", () => {
    const stale = [member("ana", 100_000, 100_000, 0)];
    expect(matrixRow(line({ invalid: true, members: stale })).members[0]?.assigned).toBeNull();
    expect(matrixRow(line({ allocated: false, members: stale })).members[0]?.assigned).toBeNull();
  });

  it("has no consumption on a SAVINGS line, whose contribution is the transfers into the members' accounts", () => {
    const savings = line({
      funding: "SAVINGS",
      members: [member("ana", 240_000, 300_000, 0), member("juan", 360_000, 0, 0)],
    });
    expect(matrixRow(savings).members.map((m) => [m.contributed, m.consumed, m.gap, m.status])).toEqual([
      [pesos(300_000), null, pesos(60_000), "OVER_CONTRIBUTED"],
      [0n, null, -pesos(360_000), "UNDER_CONTRIBUTED"],
    ]);
  });

  it("names the gap by its sign: positive over-contributed, negative under-contributed, zero on target", () => {
    expect([gapStatus(1n), gapStatus(-1n), gapStatus(0n)]).toEqual([
      "OVER_CONTRIBUTED",
      "UNDER_CONTRIBUTED",
      "ON_TARGET",
    ]);
  });
});

describe("each member's total gap (#213, D7)", () => {
  const home = line({
    members: [member("ana", 588_000, 900_000, 520_000), member("juan", 882_000, 400_000, 780_000)],
  });
  const savings = line({
    funding: "SAVINGS",
    members: [member("ana", 240_000, 0, 0), member("juan", 360_000, 0, 0)],
  });
  const rent = line({
    funding: "SHARED_FUND",
    members: [member("ana", 480_000, 0, 480_000), member("juan", 720_000, 0, 720_000)],
  });

  it("adds a member's gaps over every line that has one, with the sum's sign as its status", () => {
    const rows = [home, savings, rent].map(matrixRow);
    expect(memberTotals(["ana", "juan"], rows)).toEqual([
      { memberId: "ana", gap: pesos(72_000), status: "OVER_CONTRIBUTED" },
      { memberId: "juan", gap: -pesos(842_000), status: "UNDER_CONTRIBUTED" },
    ]);
  });

  it("is on target when the gaps cancel out, and null for a member no line gives a gap", () => {
    const over = line({ members: [member("ana", 100, 150, 0), member("juan", 100, 100, 0)] });
    const short = line({ members: [member("ana", 100, 50, 0), member("juan", 100, 100, 0)] });
    expect(memberTotals(["ana", "juan", "sofi"], [over, short, rent].map(matrixRow))).toEqual([
      { memberId: "ana", gap: 0n, status: "ON_TARGET" },
      { memberId: "juan", gap: 0n, status: "ON_TARGET" },
      { memberId: "sofi", gap: null, status: null },
    ]);
  });

  it("gives every member a null total when no line is tracked per member", () => {
    const free = line({ allocated: false, members: [member("ana", null, 50_000, 25_000)] });
    expect(memberTotals(["ana"], [free, rent].map(matrixRow))).toEqual([
      { memberId: "ana", gap: null, status: null },
    ]);
  });
});

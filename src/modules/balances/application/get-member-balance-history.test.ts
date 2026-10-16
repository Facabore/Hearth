import { describe, expect, it } from "vitest";
import { createSpaceAccess, type SpaceId, type SpaceMember } from "@/modules/spaces/application";
import { domainError, err, type LocalDate } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { anExpense, aSettlement, InMemoryTransactions } from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import {
  createGetMemberBalanceHistory,
  type BalanceHistorySource,
  type MemberBalanceHistoryView,
} from "./get-member-balance-history";
import { createGetSpaceBalances } from "./get-space-balances";

const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const SOFI = memberOf("Sofi", "VIEWER", 2);
const PEDRO = memberOf("Pedro", null, 3);

const pesos = (n: bigint) => n * 100n;
const day = (iso: string) => iso as LocalDate;
/** `payer` pays `amount` pesos in Household on `date`, split equally between Ana and Juan. */
const paysEqually = (date: string, payer: string, amount: bigint) =>
  anExpense(date, pesos(amount), {
    spaceId: "space-household",
    payments: [{ memberId: payer, accountId: null, amount: pesos(amount) }],
    shares: [
      { memberId: "member-ana", amount: pesos(amount) / 2n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: pesos(amount) / 2n, splitMethod: "EQUAL" },
    ],
  });

/**
 * HU-E5-04 Background in Household (Ana, Juan and the VIEWER Sofi): Ana pays 300,000 COP split EQUAL on 2026-10-03,
 * Juan pays 100,000 COP split EQUAL on 2026-10-10 (soft-deleted when `deleted`), Juan settles 100,000 COP to Ana on
 * 2026-10-30; neither a fund-paid expense (D5) nor Ana's own lunch moves Juan's or Ana's net.
 */
const household = async (
  options: { readonly deleted?: boolean; readonly members?: readonly SpaceMember[] } = {},
) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(options.members ?? [ANA, JUAN, SOFI]));
  const ledger = new InMemoryTransactions();
  const juans = paysEqually("2026-10-10", "member-juan", 100_000n);
  await ledger.add(paysEqually("2026-10-03", "member-ana", 300_000n));
  await ledger.add(options.deleted ? { ...juans, deletedAt: new Date("2026-10-11T12:00:00Z") } : juans);
  await ledger.add(aSettlement("2026-10-30", pesos(100_000n)));
  await ledger.add(
    anExpense("2026-10-12", pesos(80_000n), {
      spaceId: "space-household",
      payments: [{ memberId: null, accountId: "acc-household-fund", amount: pesos(80_000n) }],
      shares: [{ memberId: "member-juan", amount: pesos(80_000n), splitMethod: "EXACT" }],
    }),
  );
  await ledger.add(
    anExpense("2026-10-14", pesos(20_000n), {
      spaceId: "space-household",
      payments: [{ memberId: "member-ana", accountId: null, amount: pesos(20_000n) }],
      shares: [{ memberId: "member-ana", amount: pesos(20_000n), splitMethod: "EQUAL" }],
    }),
  );
  return { spaces, ledger };
};

interface Ask {
  readonly userId?: string;
  readonly memberId?: string;
  readonly from?: string;
  readonly to?: string;
}

/** Juan asks about Juan unless told otherwise; `source` stands in for the ledger's history. */
const askAbout = (
  { spaces, ledger }: Awaited<ReturnType<typeof household>>,
  source: BalanceHistorySource = ledger,
) => {
  const history = createGetMemberBalanceHistory({
    access: createSpaceAccess(spaces),
    members: spaces,
    history: source,
  });
  return (ask: Ask = {}) =>
    history({
      spaceId: "space-household",
      userId: ask.userId ?? "u-juan",
      memberId: ask.memberId ?? "member-juan",
      from: ask.from === undefined ? null : day(ask.from),
      to: ask.to === undefined ? null : day(ask.to),
    });
};
const world = async (options: Parameters<typeof household>[0] = {}) => askAbout(await household(options));

/** The ledger's history behind a spy: the reads it received, so a refusal can prove it never reached it. */
const watched = (ledger: InMemoryTransactions) => {
  const reads: unknown[][] = [];
  const source: BalanceHistorySource = {
    memberHistory: (...read) => {
      reads.push(read);
      return ledger.memberHistory(...read);
    },
  };
  return { source, reads };
};

/** Marta, who is no member of Household, owns "Other" (`space-other`). */
const seedMartasSpace = (spaces: InMemorySpaceStore) =>
  spaces.seed({
    ...householdSpace([memberOf("Marta", "OWNER", 0)]),
    id: "space-other" as SpaceId,
    name: "Other",
  });

const balances = (view: MemberBalanceHistoryView) => view.entries.map((e) => e.balance);

describe("GetMemberBalanceHistory (HU-E5-04)", () => {
  it("returns Juan's running net per movement: -150,000, -100,000 and 0 COP", async () => {
    const view = unwrap(await (await world())());
    expect(view.entries.map((e) => [e.type, e.date, e.change, e.balance])).toEqual([
      ["EXPENSE", "2026-10-03", pesos(-150_000n), pesos(-150_000n)],
      ["EXPENSE", "2026-10-10", pesos(50_000n), pesos(-100_000n)],
      ["SETTLEMENT", "2026-10-30", pesos(100_000n), 0n],
    ]);
    expect([view.opening, view.closing, view.currency]).toEqual([0n, 0n, "COP"]);
  });

  it("names the space, the member and the period it answers for", async () => {
    const ask = await world();
    const whole = unwrap(await ask());
    expect([whole.spaceId, whole.memberId, whole.from, whole.to]).toEqual([
      "space-household",
      "member-juan",
      null,
      null,
    ]);
    const period = unwrap(await ask({ from: "2026-10-01", to: "2026-10-15" }));
    expect([period.from, period.to]).toEqual(["2026-10-01", "2026-10-15"]);
  });

  it("limits the history to 2026-10-01 … 2026-10-15: 2 entries and a closing net of -100,000 COP", async () => {
    const view = unwrap(await (await world())({ from: "2026-10-01", to: "2026-10-15" }));
    expect([balances(view), view.opening, view.closing]).toEqual([
      [pesos(-150_000n), pesos(-100_000n)],
      0n,
      pesos(-100_000n),
    ]);
  });

  it("opens a period with the net as of the day before it, with or without movements in it", async () => {
    const ask = await world();
    const later = unwrap(await ask({ from: "2026-10-11" }));
    expect([later.opening, balances(later), later.closing]).toEqual([pesos(-100_000n), [0n], 0n]);
    const quiet = unwrap(await ask({ from: "2026-10-15", to: "2026-10-20" }));
    expect([quiet.opening, quiet.entries, quiet.closing]).toEqual([pesos(-100_000n), [], pesos(-100_000n)]);
  });

  it("includes both ends of the period: a single day returns that day's movements", async () => {
    const view = unwrap(await (await world())({ from: "2026-10-10", to: "2026-10-10" }));
    expect([view.opening, balances(view), view.closing]).toEqual([
      pesos(-150_000n),
      [pesos(-100_000n)],
      pesos(-100_000n),
    ]);
  });

  it("closes with the net after the last entry, or with the opening when nothing moved", async () => {
    const ask = await world();
    const early = unwrap(await ask({ to: "2026-10-05" }));
    expect([early.opening, balances(early), early.closing]).toEqual([
      0n,
      [pesos(-150_000n)],
      pesos(-150_000n),
    ]);
    const between = unwrap(await ask({ from: "2026-10-04", to: "2026-10-09" }));
    expect([between.opening, between.entries, between.closing]).toEqual([
      pesos(-150_000n),
      [],
      pesos(-150_000n),
    ]);
    const nobody = unwrap(await ask({ memberId: "member-sofi" }));
    expect([nobody.opening, nobody.entries, nobody.closing]).toEqual([0n, [], 0n]);
  });

  it.each([
    { deleted: false, nets: [0n, 0n, 0n] },
    { deleted: true, nets: [pesos(50_000n), pesos(-50_000n), 0n] },
  ])(
    "closes an open-ended history at the member's current net of GetSpaceBalances (deleted: $deleted)",
    async ({ deleted, nets }) => {
      const fixture = await household({ deleted });
      const ask = askAbout(fixture);
      const spaceBalances = createGetSpaceBalances({
        access: createSpaceAccess(fixture.spaces),
        members: fixture.spaces,
        source: fixture.ledger,
      });
      const current = unwrap(await spaceBalances({ spaceId: "space-household", userId: "u-ana" })).members;
      const closings = await Promise.all(
        current.map(async (m) => [m.memberId, unwrap(await ask({ memberId: m.memberId })).closing] as const),
      );
      expect(closings).toEqual(current.map((m) => [m.memberId, m.net]));
      expect(closings.map(([, closing]) => closing)).toEqual(nets);
    },
  );

  it("leaves out the soft-deleted 2026-10-10 expense: -150,000 then -50,000 COP", async () => {
    const view = unwrap(await (await world({ deleted: true }))());
    expect([balances(view), view.closing]).toEqual([[pesos(-150_000n), pesos(-50_000n)], pesos(-50_000n)]);
  });

  it("returns Ana's history to any member, Sofi the VIEWER included, without her own lunch or the fund's expense", async () => {
    const view = unwrap(await (await world())({ userId: "u-sofi", memberId: "member-ana" }));
    expect(balances(view)).toEqual([pesos(150_000n), pesos(100_000n), 0n]);
  });

  it("returns the history of a guest, who has no account of their own", async () => {
    const fixture = await household({ members: [ANA, JUAN, SOFI, PEDRO] });
    await fixture.ledger.add(
      anExpense("2026-10-05", pesos(90_000n), {
        spaceId: "space-household",
        payments: [{ memberId: "member-pedro", accountId: null, amount: pesos(90_000n) }],
        shares: [
          { memberId: "member-pedro", amount: pesos(45_000n), splitMethod: "EQUAL" },
          { memberId: "member-juan", amount: pesos(45_000n), splitMethod: "EQUAL" },
        ],
      }),
    );
    const view = unwrap(await askAbout(fixture)({ userId: "u-ana", memberId: "member-pedro" }));
    expect([balances(view), view.closing]).toEqual([[pesos(45_000n)], pesos(45_000n)]);
  });

  it("still answers for an archived space, which only reads (HU-E1-09)", async () => {
    const fixture = await household();
    fixture.spaces.archived.add("space-household");
    const view = unwrap(await askAbout(fixture)());
    expect(balances(view)).toEqual([pesos(-150_000n), pesos(-100_000n), 0n]);
  });

  it("answers SpaceNotFound to a non-member before it looks at the member or the period", async () => {
    const fixture = await household();
    seedMartasSpace(fixture.spaces);
    const { source, reads } = watched(fixture.ledger);
    const ask = askAbout(fixture, source);
    expect([
      codeOf(await ask({ userId: "u-marta" })),
      codeOf(await ask({ userId: "u-marta", memberId: "member-ana", from: "2026-10-20", to: "2026-10-01" })),
      codeOf(await ask({ userId: "u-marta", from: "2026-02-30" })),
      // Not a member of Household (she owns another space), so none of these ids may be told apart from a member's.
      codeOf(await ask({ userId: "u-marta", memberId: "member-marta" })),
      codeOf(await ask({ userId: "u-marta", memberId: "member-pedro" })),
      codeOf(await ask({ userId: "u-marta", memberId: "not-a-uuid" })),
    ]).toEqual(Array.from({ length: 6 }, () => "SpaceNotFound"));
    expect(reads).toEqual([]);
  });

  describe("a member that is not a current member of the space (Review Focus 5, ruling P29)", () => {
    const notFound = err(domainError("MemberNotFound"));

    it("answers the same MemberNotFound for a member of another space, an unknown id and a malformed one", async () => {
      const fixture = await household();
      seedMartasSpace(fixture.spaces);
      const { source, reads } = watched(fixture.ledger);
      const ask = askAbout(fixture, source);
      expect([
        await ask({ memberId: "member-marta" }),
        await ask({ memberId: "member-pedro" }),
        await ask({ memberId: "not-a-uuid" }),
        await ask({ memberId: "" }),
      ]).toEqual([notFound, notFound, notFound, notFound]);
      expect(reads).toEqual([]);
    });

    it("answers MemberNotFound for a former member, whose rows stay in the ledger, and SpaceNotFound to them", async () => {
      const fixture = await household();
      await fixture.spaces.markLeft(
        "space-household",
        "member-juan",
        "USER",
        new Date("2026-10-31T00:00:00Z"),
      );
      const ask = askAbout(fixture);
      expect(await ask({ userId: "u-ana", memberId: "member-juan" })).toEqual(notFound);
      expect(codeOf(await ask({ userId: "u-juan", memberId: "member-juan" }))).toBe("SpaceNotFound");
      expect(
        fixture.ledger.rows.some((t) => t.type === "SETTLEMENT" && t.payerMemberId === "member-juan"),
      ).toBe(true);
    });
  });

  describe("a period that cannot be read (never a 500)", () => {
    it("answers 422 ValidationFailed when `from` is after `to`, before the ledger is read", async () => {
      const fixture = await household();
      const { source, reads } = watched(fixture.ledger);
      const result = await askAbout(fixture, source)({ from: "2026-10-16", to: "2026-10-15" });
      expect(codeOf(result)).toBe("ValidationFailed");
      expect(reads).toEqual([]);
    });

    it.each([
      ["an impossible day", "2026-02-30"],
      ["an impossible month", "2026-13-01"],
      ["a day before 1900", "1899-12-31"],
      ["a year zero", "0000-06-15"],
      ["not a date", "yesterday"],
    ])("answers InvalidDate for %s on either end, before the ledger is read", async (_name, bad) => {
      const fixture = await household();
      const { source, reads } = watched(fixture.ledger);
      const ask = askAbout(fixture, source);
      expect([
        codeOf(await ask({ from: bad })),
        codeOf(await ask({ to: bad })),
        codeOf(await ask({ from: bad, to: bad })),
      ]).toEqual(["InvalidDate", "InvalidDate", "InvalidDate"]);
      expect(reads).toEqual([]);
    });

    it("reads the first day the calendar allows", async () => {
      const view = unwrap(await (await world())({ from: "1900-01-01", to: "2026-10-05" }));
      expect(balances(view)).toEqual([pesos(-150_000n)]);
    });
  });
});

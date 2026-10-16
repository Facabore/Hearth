import { describe, expect, it, vi } from "vitest";
import type { LedgerAccount, LedgerCategory, RecurrenceDeps } from "@/modules/ledger/application";
import type { SpaceMemberId } from "@/modules/spaces/application";
import { FixedClock, type LocalDate, type Result, type TransactionManager } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { recurrenceWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import { recordedOccurrence, skippedOccurrence, type OccurrenceId } from "../domain/occurrence";
import type { Recurrence } from "../domain/recurrence";
import { createDefineRecurrence, type DefineRecurrenceInput } from "./define-recurrence";
import {
  createEndRecurrence,
  createPauseRecurrence,
  createResumeRecurrence,
  createUpdateRecurrence,
  type RecurrenceEdit,
} from "./manage-recurrence";
import {
  createGetRecurrence,
  createListRecurrences,
  createListUpcomingOccurrences,
} from "./recurrence-queries";
import { checkTemplate } from "./recurrence-template";
import type * as TemplateModule from "./recurrence-template";

// The one place the check's owner is observable: a spy that still runs the real check.
vi.mock("./recurrence-template", async (importOriginal) => {
  const original = await importOriginal<typeof TemplateModule>();
  return { ...original, checkTemplate: vi.fn(original.checkTemplate) };
});

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;

/** A category the Household can use besides its own, for an edit that moves the Rent to it. */
const UTILITIES: LedgerCategory & { readonly spaceId: string } = {
  id: "cat-utilities",
  spaceId: "space-household",
  archived: false,
};

/**
 * Ana's own accounts inside Household. The accounts module keeps personal accounts in personal spaces today, so these
 * stand for the accounts an income or a transfer of a shared space would credit and debit (D9).
 */
const ANA_CHECKING: LedgerAccount = {
  id: "acc-ana-household-checking",
  spaceId: "space-household",
  ownerUserId: "u-ana",
  isSharedFund: false,
  archived: false,
};
const ANA_SAVINGS: LedgerAccount = { ...ANA_CHECKING, id: "acc-ana-household-savings" };

/** The error details a refusal carries: private to the use case's callers, never part of the problem body. */
const detailsOf = (result: Result<unknown>) => (result.ok ? undefined : result.error.details);

/** One transaction as the use case sees it: `begin`, then what it locked and saved, then `end`. */
const tracedTm = (events: string[]): TransactionManager => ({
  run: async (work) => {
    events.push("begin");
    try {
      return await work();
    } finally {
      events.push("end");
    }
  },
});

/**
 * The recurrence world with `definition` (Ana's Rent unless given) defined, and every use case over it. `events`
 * records the transaction boundaries and the lock and write of the recurrence between them; `retire` archives an
 * account or a category the way the accounts and categories modules would while a recurrence is paused.
 */
const world = async (definition: DefineRecurrenceInput = rentDefinition()) => {
  const w = recurrenceWorld();
  const events: string[] = [];
  const retired = new Set<string>();
  const { recurrences } = w;
  const lockForWrite = recurrences.lockForWrite.bind(recurrences);
  recurrences.lockForWrite = async (spaceId, recurrenceId) => {
    events.push("lock");
    return lockForWrite(spaceId, recurrenceId);
  };
  const save = recurrences.save.bind(recurrences);
  recurrences.save = async (recurrence) => {
    events.push("save");
    return save(recurrence);
  };
  const deps: RecurrenceDeps = {
    ...w.deps,
    tm: tracedTm(events),
    accounts: {
      find: async (id) => {
        const account =
          [ANA_CHECKING, ANA_SAVINGS].find((a) => a.id === id) ?? (await w.deps.accounts.find(id));
        return account !== null && retired.has(id) ? { ...account, archived: true } : account;
      },
    },
    categories: {
      find: async (spaceId, id) => {
        const category =
          spaceId === UTILITIES.spaceId && id === UTILITIES.id
            ? UTILITIES
            : await w.deps.categories.find(spaceId, id);
        return category !== null && retired.has(id) ? { id, archived: true } : category;
      },
    },
  };
  const defined = unwrap(await createDefineRecurrence(deps)(definition)).recurrence;
  events.length = 0;
  const ref = (userId = "u-ana") => ({ spaceId: "space-household", userId, recurrenceId: defined.id });
  return {
    ...w,
    deps,
    events,
    retire: (id: string) => void retired.add(id),
    defined,
    ref,
    update: createUpdateRecurrence(deps),
    pause: createPauseRecurrence(deps),
    resume: createResumeRecurrence(deps),
    end: createEndRecurrence(deps),
    list: createListRecurrences(deps),
    get: createGetRecurrence(deps),
    upcoming: createListUpcomingOccurrences(deps),
  };
};

/** The world with the recurrence paused by its definer. */
const pausedWorld = async (definition: DefineRecurrenceInput) => {
  const w = await world(definition);
  unwrap(await w.pause(w.ref(definition.userId)));
  return w;
};

const internet = rentDefinition({
  userId: "u-juan",
  description: "Internet",
  amount: cop(120_000n),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: "member-juan", accountId: ACCOUNTS.davivienda.id },
    split: null,
  },
  schedule: { kind: "MONTHLY", day: 5 },
});

/** Gym of Household, paid from Ana's Bancolombia account: a recurrence that debits a member's own account (D9). */
const gym = rentDefinition({
  description: "Gym",
  amount: cop(90_000n),
  template: {
    type: "EXPENSE",
    categoryId: CATEGORIES.household.id,
    payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
    split: null,
  },
});

const fundSplitAs = (userId: string, participants: { memberId: string }[]) =>
  rentDefinition({
    userId,
    template: {
      type: "EXPENSE",
      categoryId: CATEGORIES.household.id,
      payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
      split: { method: "EQUAL", participants },
    },
  });

const occurrenceId = (recurrence: Recurrence, date: string) => `occ-${recurrence.id}-${date}` as OccurrenceId;
const recordedOn = (recurrence: Recurrence, date: string) =>
  recordedOccurrence(
    occurrenceId(recurrence, date),
    recurrence,
    day(date),
    `tx-${date}`,
    new Date(`${date}T17:00:00Z`),
  );
const skippedOn = (recurrence: Recurrence, date: string, reason: string) =>
  skippedOccurrence(
    occurrenceId(recurrence, date),
    recurrence,
    day(date),
    reason,
    new Date(`${date}T17:00:00Z`),
  );

describe("managing a recurrence (HU-E4-11)", () => {
  it("changes the Rent to 1,300,000 COP for the occurrences not recorded yet, never a recorded one", async () => {
    const { update, ref, recurrences, defined, clock } = await world();
    const december = recordedOn(defined, "2026-12-01");
    await recurrences.addOccurrence(december);
    clock.set("2026-12-02");
    const view = unwrap(
      await update({ ...ref(), changes: { amount: cop(1_300_000n), endDate: day("2027-06-30") } }),
    );
    expect([view.recurrence.amount, view.recurrence.endDate, recurrences.rows[0]!.amount]).toEqual([
      130_000_000n,
      "2027-06-30",
      130_000_000n,
    ]);
    expect(view.recurrence.updatedAt).toEqual(new Date("2026-12-02T17:00:00Z"));
    // The recorded occurrence is a snapshot of what was recorded; the edit leaves it, and answers with it as the latest.
    expect([recurrences.occurrenceRows, view.lastOccurrence]).toEqual([[december], december]);
    expect(december.amount).toBe(120_000_000n);
  });

  it("pauses Cleaning on 2026-12-20 and resumes it on 2027-02-10: next on 2027-02-16", async () => {
    const cleaning = rentDefinition({
      description: "Cleaning",
      amount: cop(80_000n),
      schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 },
    });
    const { pause, resume, ref, clock, recurrences } = await world(cleaning);
    clock.set("2026-12-20");
    const paused = unwrap(await pause(ref()));
    expect([paused.status, paused.nextOccurrence, paused.recurrence.pauseReason]).toEqual([
      "PAUSED",
      null,
      null,
    ]);
    clock.set("2027-02-10");
    const resumed = unwrap(await resume(ref()));
    expect([resumed.status, resumed.nextOccurrence, resumed.recurrence.pausedAt]).toEqual([
      "ACTIVE",
      "2027-02-16",
      null,
    ]);
    // No date of the paused span is back-filled: it is due from the day it resumed (P24).
    expect(recurrences.rows[0]!.dueFrom).toBe("2027-02-10");
  });

  it("resumes from the day it is in APP_TIMEZONE, not the UTC date (P24)", async () => {
    const monthly = rentDefinition({ schedule: { kind: "MONTHLY", day: 10 }, startDate: day("2026-12-10") });
    const { pause, deps, ref } = await world(monthly);
    unwrap(await pause(ref()));
    // 03:00 UTC on the 11th is still 22:00 of the 10th in Bogotá: the 10th is a schedule date, due again.
    const lateEvening = { ...deps, clock: new FixedClock(new Date("2027-02-11T03:00:00Z")) };
    const resumed = unwrap(await createResumeRecurrence(lateEvening)(ref()));
    expect([resumed.recurrence.dueFrom, resumed.nextOccurrence]).toEqual(["2027-02-10", "2027-02-10"]);
  });

  it("ends a recurrence logically: ENDED and kept, refusing edits and further moves", async () => {
    const { end, update, pause, resume, ref, recurrences } = await world();
    const ended = unwrap(await end(ref()));
    expect([ended.status, ended.nextOccurrence, recurrences.rows.length]).toEqual(["ENDED", null, 1]);
    expect(recurrences.rows[0]!.endedAt).toEqual(new Date("2026-10-28T17:00:00Z"));
    expect([
      codeOf(await update({ ...ref(), changes: { description: "Rent" } })),
      codeOf(await pause(ref())),
      codeOf(await resume(ref())),
      codeOf(await end(ref())),
    ]).toEqual([
      "RecurrenceEnded",
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
      "InvalidRecurrenceTransition",
    ]);
    // An ended recurrence takes no edit, whatever the edit says: even an invalid one is told it ended.
    const invalid: RecurrenceEdit[] = [
      { schedule: { kind: "MONTHLY", day: 32 } },
      { amount: money(100n, "USD") },
      { amount: cop(0n) },
      { description: "  " },
      { endDate: day("2026-11-30") },
    ];
    const codes: string[] = [];
    for (const changes of invalid) codes.push(codeOf(await update({ ...ref(), changes })));
    expect(codes).toEqual(Array<string>(invalid.length).fill("RecurrenceEnded"));
  });

  it("ends a recurrence for good when an edit leaves it no date to record: ENDED, and no later edit or resume (P24)", async () => {
    const { update, pause, resume, ref, recurrences } = await world(
      rentDefinition({ startDate: day("2026-12-02") }),
    );
    // MONTHLY(1) from 2026-12-02 first records on 2027-01-01: an end date before it leaves nothing.
    const view = unwrap(await update({ ...ref(), changes: { endDate: day("2026-12-15") } }));
    expect([view.status, view.nextOccurrence, recurrences.rows[0]!.endedAt]).toEqual(["ENDED", null, null]);
    expect([
      codeOf(await update({ ...ref(), changes: { endDate: null } })),
      codeOf(await pause(ref())),
      codeOf(await resume(ref())),
    ]).toEqual(["RecurrenceEnded", "InvalidRecurrenceTransition", "InvalidRecurrenceTransition"]);
  });

  it("refuses to resume a recurrence whose end date passed during the pause, and still lets a member end it", async () => {
    const { pause, resume, end, ref, clock, recurrences } = await world(
      rentDefinition({ endDate: day("2027-01-31") }),
    );
    unwrap(await pause(ref()));
    clock.set("2027-02-10");
    expect(codeOf(await resume(ref()))).toBe("InvalidRecurrenceTransition");
    expect(recurrences.rows[0]!.pausedAt).not.toBeNull();
    expect(unwrap(await end(ref())).status).toBe("ENDED");
  });

  it("lets its creator, OWNERs and ADMINs manage it, never other MEMBERs or VIEWERs (P30)", async () => {
    const { pause, resume, ref } = await world();
    expect([
      codeOf(await pause(ref("u-luis"))),
      codeOf(await pause(ref("u-sofi"))),
      codeOf(await pause(ref("u-juan"))),
      codeOf(await resume(ref("u-ana"))),
    ]).toEqual(["InsufficientRole", "InsufficientRole", "ok", "ok"]);
    const luis = await world(rentDefinition({ userId: "u-luis", description: "Luis's rent" }));
    expect([
      codeOf(await luis.pause(luis.ref("u-sofi"))),
      codeOf(await luis.pause(luis.ref("u-ana"))),
      codeOf(await luis.resume(luis.ref("u-juan"))),
      codeOf(await luis.pause(luis.ref("u-luis"))),
      codeOf(await luis.resume(luis.ref("u-luis"))),
      codeOf(await luis.update({ ...luis.ref("u-luis"), changes: { description: "Rent, March" } })),
      codeOf(await luis.end(luis.ref("u-luis"))),
    ]).toEqual(["InsufficientRole", "ok", "ok", "ok", "ok", "ok", "ok"]);
  });

  it("answers InsufficientRole to every write of another MEMBER or a VIEWER, before looking at its state, and changes nothing", async () => {
    const { update, pause, resume, end, ref, recurrences, defined } = await world();
    const codes: string[] = [];
    for (const userId of ["u-luis", "u-sofi"]) {
      codes.push(
        codeOf(await update({ ...ref(userId), changes: { description: "Mine" } })),
        codeOf(await pause(ref(userId))),
        // Not paused: a member who could resume it would be told so; these are told they may not.
        codeOf(await resume(ref(userId))),
        codeOf(await end(ref(userId))),
      );
    }
    expect(codes).toEqual(Array<string>(8).fill("InsufficientRole"));
    expect(recurrences.rows).toEqual([defined]);
  });

  it("no longer lets its creator manage it once demoted to VIEWER (canModify)", async () => {
    const { pause, ref, spaces } = await world(rentDefinition({ userId: "u-luis" }));
    await spaces.updateRole("space-household", "member-luis" as SpaceMemberId, "VIEWER");
    expect([codeOf(await pause(ref("u-luis"))), codeOf(await pause(ref("u-juan")))]).toEqual([
      "InsufficientRole",
      "ok",
    ]);
  });

  it("takes the recurrence lock inside the transaction, before the role and never before the membership", async () => {
    const { update, pause, resume, end, ref, events, spaces } = await world();
    const transaction = ["begin", "lock", "save", "end"];
    const writes = [
      () => update({ ...ref(), changes: { description: "Rent" } }),
      () => pause(ref()),
      () => resume(ref()),
      () => end(ref()),
    ];
    for (const write of writes) {
      events.length = 0;
      expect(codeOf(await write())).toBe("ok");
      expect(events).toEqual(transaction);
    }
    // The role is looked at under the lock: a refusal has locked, and has written nothing.
    events.length = 0;
    await pause(ref("u-luis"));
    expect(events).toEqual(["begin", "lock", "end"]);
    // A non-member and an archived space are refused before the recurrence is touched.
    events.length = 0;
    await pause(ref("u-marta"));
    await spaces.archive("space-household");
    await pause(ref());
    expect(events).toEqual(["begin", "end", "begin", "end"]);
  });

  it("lets only its creator change a recurrence that debits their own account, every field of it (D9, P22)", async () => {
    // Gym is CONFIRM, so that switching it to AUTO is a real change.
    const { update, ref, recurrences, defined } = await world({ ...gym, mode: "CONFIRM" });
    const edits: RecurrenceEdit[] = [
      { amount: cop(95_000n) },
      { description: "Gym, renewed" },
      { categoryId: UTILITIES.id },
      { split: { method: "EQUAL", participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }] } },
      { schedule: { kind: "MONTHLY", day: 5 } },
      { mode: "AUTO" },
      { endDate: day("2027-06-30") },
    ];
    const by = async (userId: string) => {
      const codes: string[] = [];
      for (const changes of edits) codes.push(codeOf(await update({ ...ref(userId), changes })));
      return codes;
    };
    // The role comes first: another MEMBER may not manage it at all; an ADMIN is told it is Ana's account.
    expect(await by("u-luis")).toEqual(Array<string>(edits.length).fill("InsufficientRole"));
    expect(await by("u-juan")).toEqual(Array<string>(edits.length).fill("AccountNotOwned"));
    expect(recurrences.rows).toEqual([defined]);
    expect(await by("u-ana")).toEqual(Array<string>(edits.length).fill("ok"));
    expect(recurrences.rows[0]).toMatchObject({ mode: "AUTO", endDate: "2027-06-30" });
  });

  it("lets only its creator resume it, but an OWNER or ADMIN pause and end it: that only stops the debits (D9)", async () => {
    const fromAnasAccount = rentDefinition({
      template: {
        type: "FUND_CONTRIBUTION",
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-ana",
        sourceAccountId: ACCOUNTS.bancolombia.id,
      },
    });
    // Ana's Gym and contribution are debited from her account; Juan's Internet from his.
    const cases = [
      { definition: gym, creator: "u-ana", other: "u-juan" },
      { definition: fromAnasAccount, creator: "u-ana", other: "u-juan" },
      { definition: internet, creator: "u-juan", other: "u-ana" },
    ];
    const codes: string[] = [];
    for (const { definition, creator, other } of cases) {
      const w = await world(definition);
      codes.push(
        codeOf(await w.pause(w.ref(other))),
        codeOf(await w.resume(w.ref(other))),
        codeOf(await w.resume(w.ref(creator))),
        codeOf(await w.pause(w.ref(other))),
        codeOf(await w.end(w.ref(other))),
      );
    }
    expect(codes).toEqual(cases.flatMap(() => ["ok", "AccountNotOwned", "ok", "ok", "ok"]));
  });

  it("lets only its creator change or resume an income or a transfer between their own accounts: their money moves too (D9)", async () => {
    const income = rentDefinition({
      description: "Reimbursement",
      mode: "CONFIRM",
      template: { type: "INCOME", categoryId: CATEGORIES.household.id, accountId: ANA_CHECKING.id },
    });
    const saving = rentDefinition({
      description: "Saving",
      mode: "CONFIRM",
      template: {
        type: "TRANSFER",
        sourceAccountId: ANA_CHECKING.id,
        destinationAccountId: ANA_SAVINGS.id,
      },
    });
    const incomeEdits: RecurrenceEdit[] = [
      { amount: cop(95_000n) },
      { description: "Reimbursement, renewed" },
      { categoryId: UTILITIES.id },
      { schedule: { kind: "MONTHLY", day: 5 } },
      { mode: "AUTO" },
      { endDate: day("2027-06-30") },
    ];
    const savingEdits = incomeEdits.filter((edit) => edit.categoryId === undefined);
    for (const { definition, edits } of [
      { definition: income, edits: incomeEdits },
      { definition: saving, edits: savingEdits },
    ]) {
      const w = await world(definition);
      const by = async (userId: string) => {
        const codes: string[] = [];
        for (const changes of edits) codes.push(codeOf(await w.update({ ...w.ref(userId), changes })));
        return codes;
      };
      expect(await by("u-luis")).toEqual(Array<string>(edits.length).fill("InsufficientRole"));
      expect(await by("u-juan")).toEqual(Array<string>(edits.length).fill("AccountNotOwned"));
      expect(w.recurrences.rows).toEqual([w.defined]);
      // Pausing and ending only stop the movements; resuming turns them back on.
      expect([
        codeOf(await w.pause(w.ref("u-juan"))),
        codeOf(await w.resume(w.ref("u-juan"))),
        codeOf(await w.resume(w.ref("u-ana"))),
        codeOf(await w.end(w.ref("u-juan"))),
      ]).toEqual(["ok", "AccountNotOwned", "ok", "ok"]);
    }
    // Ana changes her own: the creator is always allowed.
    const own = await world(income);
    const codes: string[] = [];
    for (const changes of incomeEdits) codes.push(codeOf(await own.update({ ...own.ref("u-ana"), changes })));
    expect(codes).toEqual(Array<string>(incomeEdits.length).fill("ok"));
  });

  it("checks a changed or resumed template for its creator, not for whoever changes it (P21)", async () => {
    // Nothing a fund-paid Rent names depends on the user, so only the owner handed to the check shows whom it is for.
    const { update, pause, resume, ref } = await world(rentDefinition({ userId: "u-luis" }));
    vi.mocked(checkTemplate).mockClear();
    unwrap(await update({ ...ref("u-ana"), changes: { amount: cop(1_300_000n) } }));
    unwrap(await pause(ref("u-ana")));
    unwrap(await resume(ref("u-juan")));
    const owner = { spaceId: "space-household", creatorUserId: "u-luis" };
    expect(vi.mocked(checkTemplate).mock.calls.map(([, checkedFor]) => checkedFor)).toEqual([owner, owner]);
  });

  it("keeps canModify for everything when no member's own account is debited: the fund pays, or a guest (D9, D15)", async () => {
    const forGuest = rentDefinition({
      userId: "u-luis",
      template: {
        type: "EXPENSE",
        categoryId: CATEGORIES.household.id,
        payer: { memberId: "member-pedro", accountId: null },
        split: null,
      },
    });
    const guestContribution = rentDefinition({
      template: {
        type: "FUND_CONTRIBUTION",
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-pedro",
        sourceAccountId: null,
      },
    });
    const codes: string[] = [];
    for (const definition of [rentDefinition(), forGuest, guestContribution]) {
      const w = await world({ ...definition, mode: "CONFIRM" });
      const juan = w.ref("u-juan");
      codes.push(
        codeOf(await w.update({ ...juan, changes: { amount: cop(1_300_000n) } })),
        codeOf(await w.update({ ...juan, changes: { mode: "AUTO" } })),
        codeOf(await w.update({ ...juan, changes: { schedule: { kind: "MONTHLY", day: 5 } } })),
        codeOf(await w.pause(juan)),
        codeOf(await w.resume(juan)),
        codeOf(await w.end(juan)),
      );
    }
    expect(codes).toEqual(Array<string>(18).fill("ok"));
  });

  it("checks a new category, split or schedule as defining would", async () => {
    const { update, ref, recurrences } = await world();
    expect([
      codeOf(await update({ ...ref(), changes: { categoryId: CATEGORIES.groceries.id } })),
      codeOf(
        await update({
          ...ref(),
          changes: { split: { method: "EQUAL", participants: [{ memberId: "member-marta" }] } },
        }),
      ),
      codeOf(await update({ ...ref(), changes: { schedule: { kind: "MONTHLY", day: 32 } } })),
      codeOf(
        await update({
          ...ref(),
          changes: {
            split: {
              method: "SHARES",
              participants: [
                { memberId: "member-ana", units: 1 },
                { memberId: "member-juan", units: 2 },
              ],
            },
          },
        }),
      ),
    ]).toEqual(["CategoryNotFound", "NotASpaceMember", "InvalidPeriodPolicy", "ok"]);
    expect(codeOf(await update({ ...ref(), changes: { categoryId: UTILITIES.id } }))).toBe("ok");
    expect(recurrences.rows[0]!.template).toMatchObject({
      categoryId: UTILITIES.id,
      split: { method: "SHARES" },
    });
  });

  it("checks a new amount against the split it shares, and refuses what defining refuses, storing nothing", async () => {
    const shared = await world(
      fundSplitAs("u-ana", [{ memberId: "member-ana" }, { memberId: "member-juan" }]),
    );
    const { update, ref, recurrences, defined } = shared;
    const refused = [
      // 1 COP is one rounding unit: it cannot give two members a positive share.
      { amount: cop(1n) },
      { amount: cop(0n) },
      { amount: money(100n, "USD") },
      { description: "  " },
      { endDate: day("2026-11-30") },
      { schedule: { kind: "SEMI_MONTHLY", day1: 16, day2: 1 } },
    ] as const;
    const codes: string[] = [];
    for (const changes of refused) codes.push(codeOf(await update({ ...ref(), changes })));
    expect(codes).toEqual([
      "InvalidSplit",
      "InvalidAmount",
      "CurrencyMismatch",
      "InvalidDescription",
      "InvalidRecurrence",
      "InvalidPeriodPolicy",
    ]);
    expect(recurrences.rows).toEqual([defined]);
  });

  it("leaves a recurrence that debits a member who left only to be ended: nobody else may change or resume it (D9, P26)", async () => {
    const { resume, update, end, ref, spaces, recurrences } = await pausedWorld(internet);
    await spaces.markLeft("space-household", "member-juan", "USER", new Date("2026-11-01T12:00:00Z"));
    expect([
      codeOf(await resume(ref("u-ana"))),
      codeOf(await update({ ...ref("u-ana"), changes: { description: "Internet (old)" } })),
      codeOf(await resume(ref("u-juan"))),
    ]).toEqual(["AccountNotOwned", "AccountNotOwned", "SpaceNotFound"]);
    expect(recurrences.rows[0]!.pausedAt).not.toBeNull();
    expect(unwrap(await end(ref("u-ana"))).status).toBe("ENDED");
  });

  it("resumes only while its creator can still record: demoted to VIEWER, the answer is InsufficientRole (P21, P26)", async () => {
    const { resume, ref, spaces, recurrences } = await pausedWorld(rentDefinition({ userId: "u-luis" }));
    const luis = "member-luis" as SpaceMemberId;
    await spaces.updateRole("space-household", luis, "VIEWER");
    // An OWNER may resume anyone's recurrence, but not one that would record for a member who may not record: the
    // detail tells that refusal (about the creator) from Luis's own (about the requester).
    const byOwner = await resume(ref("u-ana"));
    const byCreator = await resume(ref("u-luis"));
    expect([codeOf(byOwner), codeOf(byCreator)]).toEqual(["InsufficientRole", "InsufficientRole"]);
    expect([detailsOf(byOwner), detailsOf(byCreator)]).toEqual([{ member: "creator" }, undefined]);
    expect(recurrences.rows[0]!.pausedAt).not.toBeNull();
    await spaces.updateRole("space-household", luis, "MEMBER");
    expect(codeOf(await resume(ref("u-ana")))).toBe("ok");
  });

  it("lets a recurrence whose creator left be renamed, rescheduled or ended, but not checked again (P21, P26)", async () => {
    const { update, end, ref, spaces, recurrences } = await world();
    await spaces.markLeft("space-household", "member-ana", "USER", new Date("2026-11-01T12:00:00Z"));
    const juan = ref("u-juan");
    const refused = [
      await update({ ...juan, changes: { amount: cop(1_300_000n) } }),
      await update({ ...juan, changes: { categoryId: UTILITIES.id } }),
      await update({ ...juan, changes: { split: null } }),
    ];
    expect(refused.map(codeOf)).toEqual(["NotASpaceMember", "NotASpaceMember", "NotASpaceMember"]);
    expect(refused.map(detailsOf)).toEqual(Array(3).fill({ member: "creator" }));
    expect(recurrences.rows[0]!.amount).toBe(120_000_000n);
    expect([
      codeOf(await update({ ...juan, changes: { description: "Old rent" } })),
      codeOf(await update({ ...juan, changes: { schedule: { kind: "MONTHLY", day: 5 } } })),
      codeOf(await update({ ...juan, changes: { mode: "CONFIRM" } })),
      codeOf(await update({ ...juan, changes: { endDate: day("2027-06-30") } })),
      codeOf(await end(juan)),
    ]).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });

  it("resumes only if the guest paying, a split participant or its creator are still members (P26)", async () => {
    const forGuest = rentDefinition({
      userId: "u-luis",
      template: {
        type: "EXPENSE",
        categoryId: CATEGORIES.household.id,
        payer: { memberId: "member-pedro", accountId: null },
        split: null,
      },
    });
    const guest = await pausedWorld(forGuest);
    await guest.spaces.markLeft("space-household", "member-pedro", "GUEST", new Date("2026-11-01T12:00:00Z"));
    const participant = await pausedWorld(
      fundSplitAs("u-ana", [{ memberId: "member-ana" }, { memberId: "member-luis" }]),
    );
    await participant.spaces.markLeft(
      "space-household",
      "member-luis",
      "USER",
      new Date("2026-11-01T12:00:00Z"),
    );
    const creator = await pausedWorld(rentDefinition());
    await creator.spaces.markLeft("space-household", "member-ana", "USER", new Date("2026-11-01T12:00:00Z"));
    const resumed = [
      await guest.resume(guest.ref("u-ana")),
      await participant.resume(participant.ref("u-ana")),
      // The Rent is paid from the fund, so only its creator leaving blocks it; an ADMIN cannot resume it for her.
      await creator.resume(creator.ref("u-juan")),
    ];
    expect(resumed.map(codeOf)).toEqual(["NotASpaceMember", "NotASpaceMember", "NotASpaceMember"]);
    // Only the creator's absence says so: the guest and the participant are the template's, not the creator's.
    expect(resumed.map(detailsOf)).toEqual([undefined, undefined, { member: "creator" }]);
    for (const w of [guest, participant, creator]) expect(w.recurrences.rows[0]!.pausedAt).not.toBeNull();
  });

  it("checks the account and the category again on resuming (P26)", async () => {
    const fund = await pausedWorld(rentDefinition());
    fund.retire(ACCOUNTS.householdFund.id);
    const category = await pausedWorld(rentDefinition());
    category.retire(CATEGORIES.household.id);
    expect([codeOf(await fund.resume(fund.ref())), codeOf(await category.resume(category.ref()))]).toEqual([
      "AccountArchived",
      "CategoryArchived",
    ]);
    expect(fund.recurrences.rows[0]!.pausedAt).not.toBeNull();
  });

  it("answers RecurrenceNotFound for another space's or a malformed id, and SpaceArchived to every write of an archived space", async () => {
    const { update, pause, resume, end, get, ref, spaces, recurrences, defined, events } = await world();
    expect([
      codeOf(await pause({ ...ref(), recurrenceId: "not-a-recurrence" })),
      codeOf(await pause({ ...ref(), spaceId: "space-ana" })),
      codeOf(await get({ ...ref(), spaceId: "space-ana" })),
    ]).toEqual(["RecurrenceNotFound", "RecurrenceNotFound", "RecurrenceNotFound"]);
    expect([
      codeOf(await update({ ...ref("u-marta"), changes: { description: "Rent" } })),
      codeOf(await pause({ ...ref("u-marta"), recurrenceId: "not-a-recurrence" })),
    ]).toEqual(["SpaceNotFound", "SpaceNotFound"]);
    await spaces.archive("space-household");
    events.length = 0;
    expect([
      codeOf(await update({ ...ref(), changes: { description: "Rent" } })),
      codeOf(await pause(ref())),
      codeOf(await resume(ref())),
      codeOf(await end(ref())),
      codeOf(await get(ref())),
    ]).toEqual(["SpaceArchived", "SpaceArchived", "SpaceArchived", "SpaceArchived", "ok"]);
    expect(recurrences.rows).toEqual([defined]);
    expect(events.filter((e) => e === "lock" || e === "save")).toEqual([]);
  });
});

describe("reading recurrences (HU-E4-11)", () => {
  it("lists the space's recurrences in the order they were defined, for every member", async () => {
    const { list, deps } = await world();
    unwrap(await createDefineRecurrence(deps)(rentDefinition({ description: "Cleaning" })));
    const views = unwrap(await list({ spaceId: "space-household", userId: "u-sofi" }));
    expect(views.map((v) => [v.recurrence.description, v.status, v.nextOccurrence])).toEqual([
      ["Rent", "ACTIVE", "2026-12-01"],
      ["Cleaning", "ACTIVE", "2026-12-01"],
    ]);
    expect(codeOf(await list({ spaceId: "space-household", userId: "u-marta" }))).toBe("SpaceNotFound");
  });

  it("shows each recurrence's status, next date and latest occurrence, none for one that has none", async () => {
    const { list, get, deps, pause, end, recurrences, defined: rent } = await world();
    const define = createDefineRecurrence(deps);
    const cleaning = unwrap(
      await define(
        rentDefinition({ description: "Cleaning", schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }),
      ),
    ).recurrence;
    const pool = unwrap(await define(rentDefinition({ description: "Pool" }))).recurrence;
    const salary = unwrap(
      await define(
        rentDefinition({
          spaceId: "space-ana",
          description: "Salary",
          template: { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.bancolombia.id },
        }),
      ),
    ).recurrence;
    const of = (recurrenceId: string) => ({ spaceId: "space-household", userId: "u-ana", recurrenceId });
    unwrap(await pause(of(cleaning.id)));
    unwrap(await end(of(pool.id)));
    // The scheduler has recorded December and January for the Rent and skipped February: it is due again on March 1.
    const february = skippedOn(rent, "2027-02-01", "PeriodClosed");
    const december = recordedOn(rent, "2026-12-01");
    const january = recordedOn(rent, "2027-01-01");
    const lastOfPool = recordedOn(pool, "2026-12-01");
    for (const occurrence of [february, december, lastOfPool, january, recordedOn(salary, "2026-12-01")]) {
      await recurrences.addOccurrence(occurrence);
    }
    recurrences.rows = recurrences.rows.map((r) =>
      r.id === rent.id ? { ...r, dueFrom: day("2027-03-01") } : r,
    );

    const views = unwrap(await list({ spaceId: "space-household", userId: "u-sofi" }));
    expect(
      views.map((v) => [v.recurrence.description, v.status, v.nextOccurrence, v.lastOccurrence]),
    ).toEqual([
      ["Rent", "ACTIVE", "2027-03-01", february],
      ["Cleaning", "PAUSED", null, null],
      ["Pool", "ENDED", null, lastOfPool],
    ]);
    expect(unwrap(await get(of(pool.id)))).toEqual(views[2]);
    expect(
      unwrap(await list({ spaceId: "space-ana", userId: "u-ana" })).map((v) => v.recurrence.description),
    ).toEqual(["Salary"]);
  });

  it("reads an archived space's recurrences, and the dates of one that is paused or ended are none", async () => {
    const { list, get, upcoming, ref, spaces } = await world();
    await spaces.archive("space-household");
    expect([
      codeOf(await list({ spaceId: "space-household", userId: "u-sofi" })),
      codeOf(await get(ref("u-sofi"))),
      unwrap(await upcoming({ ...ref("u-sofi"), count: 2 })),
    ]).toEqual(["ok", "ok", ["2026-12-01", "2027-01-01"]]);
    const paused = await world();
    unwrap(await paused.pause(paused.ref()));
    const ended = await world();
    unwrap(await ended.end(ended.ref()));
    expect([
      unwrap(await paused.upcoming({ ...paused.ref(), count: 3 })),
      unwrap(await ended.upcoming({ ...ended.ref(), count: 3 })),
    ]).toEqual([[], []]);
  });

  it("previews MONTHLY(31) from 2027-01-01 as 2027-01-31, 2027-02-28, 2027-03-31, and SEMI_MONTHLY(1, 16) in December", async () => {
    const clamped = await world(
      rentDefinition({ schedule: { kind: "MONTHLY", day: 31 }, startDate: day("2027-01-01") }),
    );
    expect(unwrap(await clamped.upcoming({ ...clamped.ref("u-sofi"), count: 3 }))).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
    ]);
    const cleaning = await world(rentDefinition({ schedule: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }));
    expect(unwrap(await cleaning.upcoming({ ...cleaning.ref(), count: 2 }))).toEqual([
      "2026-12-01",
      "2026-12-16",
    ]);
  });

  it("previews at most 24 dates, and answers InvalidRecurrence to any count that is not an integer from 1 to 24", async () => {
    const { upcoming, ref } = await world();
    expect(unwrap(await upcoming({ ...ref(), count: 24 }))).toHaveLength(24);
    expect(unwrap(await upcoming({ ...ref(), count: 1 }))).toEqual(["2026-12-01"]);
    const counts = [0, -1, 25, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
    const codes: string[] = [];
    for (const count of counts) codes.push(codeOf(await upcoming({ ...ref(), count })));
    expect(codes).toEqual(Array<string>(counts.length).fill("InvalidRecurrence"));
    // Membership comes first, so a bad count tells a stranger nothing about the space. The count is checked before the
    // recurrence is looked up: a bad count on an unknown id is the count's refusal, a good one is not found.
    expect([
      codeOf(await upcoming({ ...ref("u-marta"), count: Number.NaN })),
      codeOf(await upcoming({ ...ref(), recurrenceId: "not-a-recurrence", count: 0 })),
      codeOf(await upcoming({ ...ref(), spaceId: "space-ana", count: 3 })),
    ]).toEqual(["SpaceNotFound", "InvalidRecurrence", "RecurrenceNotFound"]);
  });
});

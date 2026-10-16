import { describe, expect, it } from "vitest";
import { FixedClock, type LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { recurrenceWorld, rentDefinition } from "../../../../tests/support/in-memory-recurrences";
import type { RecurrenceSplit, RecurrenceTemplate } from "../domain/recurrence";
import { createDefineRecurrence, type DefineRecurrenceInput } from "./define-recurrence";
import { createRecordIncome } from "./record-income";
import { createRecordTransfer } from "./record-transfer";
import { checkTemplate } from "./recurrence-template";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;

/** Rent of Household, paid by this member from this account, or from the fund (member null). */
const paidBy = (memberId: string | null, accountId: string | null) =>
  rentDefinition({
    template: {
      type: "EXPENSE",
      categoryId: CATEGORIES.household.id,
      payer: { memberId, accountId },
      split: null,
    },
  });

/** Rent paid from the Household Fund and shared as `split`. */
const splitAs = (split: RecurrenceSplit) =>
  rentDefinition({
    template: {
      type: "EXPENSE",
      categoryId: CATEGORIES.household.id,
      payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
      split,
    },
  });

describe("DefineRecurrence (HU-E4-11)", () => {
  it("defines the monthly Rent paid from the shared fund: ACTIVE, next on 2026-12-01", async () => {
    const { deps, recurrences } = recurrenceWorld();
    const view = unwrap(await createDefineRecurrence(deps)(rentDefinition()));
    expect([view.status, view.nextOccurrence, view.lastOccurrence]).toEqual(["ACTIVE", "2026-12-01", null]);
    expect(view.recurrence).toMatchObject({
      spaceId: "space-household",
      description: "Rent",
      amount: 120_000_000n,
      currency: "COP",
      mode: "AUTO",
      dueFrom: "2026-12-01",
      createdBy: "u-ana",
      template: {
        type: "EXPENSE",
        payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
        split: null,
      },
    });
    expect(recurrences.rows).toEqual([view.recurrence]);
  });

  it("is due from the definition day when it starts earlier: next on 2026-11-01 (P24)", async () => {
    const view = unwrap(
      await createDefineRecurrence(recurrenceWorld().deps)(rentDefinition({ startDate: day("2026-10-01") })),
    );
    expect([view.recurrence.dueFrom, view.nextOccurrence]).toEqual(["2026-10-28", "2026-11-01"]);
  });

  it("takes the definition day from the clock the test moves, in APP_TIMEZONE (P24)", async () => {
    const { deps, clock } = recurrenceWorld();
    clock.set("2026-12-20");
    const moved = unwrap(await createDefineRecurrence(deps)(rentDefinition()));
    expect([moved.recurrence.dueFrom, moved.nextOccurrence]).toEqual(["2026-12-20", "2027-01-01"]);
    // 03:00 UTC on the 29th is still 22:00 of the 28th in Bogotá: the definition day is not the UTC date.
    const lateEvening = { ...deps, clock: new FixedClock(new Date("2026-10-29T03:00:00Z")) };
    const evening = unwrap(
      await createDefineRecurrence(lateEvening)(rentDefinition({ startDate: day("2026-10-01") })),
    );
    expect(evening.recurrence.dueFrom).toBe("2026-10-28");
  });

  it("refuses VIEWERs, non-members and archived spaces", async () => {
    const { deps, spaces, recurrences } = recurrenceWorld();
    const define = createDefineRecurrence(deps);
    expect(codeOf(await define(rentDefinition({ userId: "u-sofi" })))).toBe("InsufficientRole");
    expect(codeOf(await define(rentDefinition({ userId: "u-marta" })))).toBe("SpaceNotFound");
    await spaces.archive("space-household");
    expect(codeOf(await define(rentDefinition()))).toBe("SpaceArchived");
    expect(recurrences.rows).toEqual([]);
  });

  it("lets only Juan define Internet paid from his Davivienda account (D9, P21)", async () => {
    const define = createDefineRecurrence(recurrenceWorld().deps);
    const internet = rentDefinition({
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
    expect(codeOf(await define(internet))).toBe("AccountNotOwned");
    expect(codeOf(await define({ ...internet, userId: "u-juan" }))).toBe("ok");
  });

  it("holds D9 for a contribution from another member's account, but lets any writer spend the fund or pay for a guest (D15)", async () => {
    const { deps, recurrences } = recurrenceWorld();
    const define = createDefineRecurrence(deps);
    const fromAnasAccount = rentDefinition({
      description: "Fund",
      template: {
        type: "FUND_CONTRIBUTION",
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-ana",
        sourceAccountId: ACCOUNTS.bancolombia.id,
      },
    });
    const forPedro = rentDefinition({
      description: "Pedro's share",
      template: {
        type: "FUND_CONTRIBUTION",
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-pedro",
        sourceAccountId: null,
      },
    });
    const codes: string[] = [];
    for (const userId of ["u-juan", "u-luis"]) {
      codes.push(codeOf(await define({ ...fromAnasAccount, userId })));
      codes.push(codeOf(await define({ ...paidBy(null, ACCOUNTS.householdFund.id), userId })));
      codes.push(codeOf(await define({ ...paidBy("member-pedro", null), userId })));
      codes.push(codeOf(await define({ ...forPedro, userId })));
    }
    expect(codes).toEqual(["AccountNotOwned", "ok", "ok", "ok", "AccountNotOwned", "ok", "ok", "ok"]);
    expect(recurrences.rows.map((r) => r.createdBy)).toEqual([
      "u-juan",
      "u-juan",
      "u-juan",
      "u-luis",
      "u-luis",
      "u-luis",
    ]);
  });

  it("checks the template as recording would: guests, other spaces' funds, categories, splits, amounts and anchors", async () => {
    const { deps, recurrences } = recurrenceWorld();
    const define = createDefineRecurrence(deps);
    const inputs: DefineRecurrenceInput[] = [
      paidBy("member-pedro", null),
      paidBy("member-pedro", ACCOUNTS.bancolombia.id),
      paidBy(null, ACCOUNTS.tripFund.id),
      paidBy(null, null),
      rentDefinition({
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.groceries.id,
          payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
          split: null,
        },
      }),
      splitAs({ method: "EQUAL", participants: [{ memberId: "member-marta" }] }),
      splitAs({
        method: "PERCENT",
        participants: [
          { memberId: "member-ana", basisPoints: 4000 },
          { memberId: "member-juan", basisPoints: 5000 },
        ],
      }),
      // 1 COP is one rounding unit: it cannot give two members a positive share.
      {
        ...splitAs({
          method: "EQUAL",
          participants: [{ memberId: "member-ana" }, { memberId: "member-juan" }],
        }),
        amount: cop(1n),
      },
      rentDefinition({ amount: cop(0n) }),
      rentDefinition({ amount: money(100n, "USD") }),
      rentDefinition({ schedule: { kind: "SEMI_MONTHLY", day1: 16, day2: 1 } }),
      rentDefinition({ endDate: day("2026-11-30") }),
      rentDefinition({ description: "" }),
    ];
    const codes: string[] = [];
    for (const input of inputs) codes.push(codeOf(await define(input)));
    expect(codes).toEqual([
      "ok",
      "GuestHasNoAccounts",
      "AccountNotFound",
      "AccountRequired",
      "CategoryNotFound",
      "NotASpaceMember",
      "InvalidSplit",
      "InvalidSplit",
      "InvalidAmount",
      "CurrencyMismatch",
      "InvalidPeriodPolicy",
      "InvalidRecurrence",
      "InvalidDescription",
    ]);
    // Only the first definition was valid: no refusal stored anything.
    expect(recurrences.rows).toHaveLength(1);
  });

  it("refuses archived accounts and categories, as recording would", async () => {
    const define = createDefineRecurrence(recurrenceWorld().deps);
    const personal = { spaceId: "space-ana" };
    const inputs: DefineRecurrenceInput[] = [
      rentDefinition({
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: null, accountId: ACCOUNTS.oldFund.id },
          split: null,
        },
      }),
      rentDefinition({
        template: {
          type: "EXPENSE",
          categoryId: CATEGORIES.household.id,
          payer: { memberId: "member-ana", accountId: ACCOUNTS.oldNequi.id },
          split: null,
        },
      }),
      rentDefinition({
        template: {
          type: "FUND_CONTRIBUTION",
          fundAccountId: ACCOUNTS.oldFund.id,
          sourceAccountId: ACCOUNTS.bancolombia.id,
        },
      }),
      rentDefinition({
        ...personal,
        template: { type: "INCOME", categoryId: CATEGORIES.archived.id, accountId: ACCOUNTS.bancolombia.id },
      }),
      rentDefinition({
        ...personal,
        template: { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.oldNequi.id },
      }),
      rentDefinition({
        ...personal,
        template: {
          type: "TRANSFER",
          sourceAccountId: ACCOUNTS.bancolombia.id,
          destinationAccountId: ACCOUNTS.oldNequi.id,
        },
      }),
    ];
    const codes: string[] = [];
    for (const input of inputs) codes.push(codeOf(await define(input)));
    expect(codes).toEqual([
      "AccountArchived",
      "AccountArchived",
      "AccountArchived",
      "CategoryArchived",
      "AccountArchived",
      "AccountArchived",
    ]);
  });

  it("defines incomes and transfers of Ana's personal space and her contribution to the fund", async () => {
    const define = createDefineRecurrence(recurrenceWorld().deps);
    const personal = { spaceId: "space-ana" };
    const salary = unwrap(
      await define(
        rentDefinition({
          ...personal,
          description: "Salary",
          template: { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.bancolombia.id },
        }),
      ),
    );
    const saving = unwrap(
      await define(
        rentDefinition({
          ...personal,
          description: "Saving",
          template: {
            type: "TRANSFER",
            sourceAccountId: ACCOUNTS.bancolombia.id,
            destinationAccountId: ACCOUNTS.nequi.id,
          },
        }),
      ),
    );
    const contribution = unwrap(
      await define(
        rentDefinition({
          description: "Fund",
          template: {
            type: "FUND_CONTRIBUTION",
            fundAccountId: ACCOUNTS.householdFund.id,
            sourceAccountId: ACCOUNTS.bancolombia.id,
          },
        }),
      ),
    );
    expect([salary.status, saving.status, contribution.recurrence.template]).toEqual([
      "ACTIVE",
      "ACTIVE",
      {
        type: "FUND_CONTRIBUTION",
        fundAccountId: ACCOUNTS.householdFund.id,
        memberId: "member-ana",
        sourceAccountId: ACCOUNTS.bancolombia.id,
      },
    ]);
    const income = {
      type: "INCOME" as const,
      categoryId: CATEGORIES.household.id,
      accountId: ACCOUNTS.bancolombia.id,
    };
    const sameAccount = {
      type: "TRANSFER" as const,
      sourceAccountId: ACCOUNTS.bancolombia.id,
      destinationAccountId: ACCOUNTS.bancolombia.id,
    };
    expect([
      codeOf(await define(rentDefinition({ template: income }))),
      codeOf(await define(rentDefinition({ ...personal, template: sameAccount }))),
    ]).toEqual(["AccountNotInSpace", "SameAccountTransfer"]);
  });

  it("refuses incomes and transfers through another member's account exactly where recording does (D9)", async () => {
    const { deps } = recurrenceWorld();
    const define = createDefineRecurrence(deps);
    const recordIncome = createRecordIncome(deps);
    const recordTransfer = createRecordTransfer(deps);
    const income = (accountId: string, categoryId: string): RecurrenceTemplate => ({
      type: "INCOME",
      categoryId,
      accountId,
    });
    const transfer = (sourceAccountId: string, destinationAccountId: string): RecurrenceTemplate => ({
      type: "TRANSFER",
      sourceAccountId,
      destinationAccountId,
    });
    const { bancolombia, nequi, davivienda } = ACCOUNTS;
    const cases: { userId: string; spaceId: string; template: RecurrenceTemplate; code: string }[] = [
      // Juan credits Ana's account, in Household and with his own account of another space.
      {
        userId: "u-juan",
        spaceId: "space-household",
        template: income(bancolombia.id, CATEGORIES.household.id),
        code: "AccountNotOwned",
      },
      {
        userId: "u-juan",
        spaceId: "space-household",
        template: income(davivienda.id, CATEGORIES.household.id),
        code: "AccountNotInSpace",
      },
      // Ana credits Juan's account from her personal space; her own accounts are allowed.
      {
        userId: "u-ana",
        spaceId: "space-ana",
        template: income(davivienda.id, CATEGORIES.salary.id),
        code: "AccountNotOwned",
      },
      {
        userId: "u-ana",
        spaceId: "space-ana",
        template: income(bancolombia.id, CATEGORIES.salary.id),
        code: "ok",
      },
      // A transfer takes money out of, or puts it into, no account but the creator's own.
      {
        userId: "u-ana",
        spaceId: "space-ana",
        template: transfer(bancolombia.id, davivienda.id),
        code: "AccountNotOwned",
      },
      {
        userId: "u-ana",
        spaceId: "space-ana",
        template: transfer(davivienda.id, nequi.id),
        code: "AccountNotOwned",
      },
      {
        userId: "u-juan",
        spaceId: "space-household",
        template: transfer(bancolombia.id, davivienda.id),
        code: "AccountNotOwned",
      },
      // The same account is refused before anyone's ownership is looked at, as recording does.
      {
        userId: "u-ana",
        spaceId: "space-ana",
        template: transfer(davivienda.id, davivienda.id),
        code: "SameAccountTransfer",
      },
      { userId: "u-ana", spaceId: "space-ana", template: transfer(bancolombia.id, nequi.id), code: "ok" },
    ];
    const recordedAs = async (userId: string, spaceId: string, template: RecurrenceTemplate) => {
      const amount = cop(50_000n);
      switch (template.type) {
        case "INCOME":
          return codeOf(
            await recordIncome({
              spaceId,
              userId,
              amount,
              categoryId: template.categoryId,
              accountId: template.accountId,
            }),
          );
        case "TRANSFER":
          return codeOf(
            await recordTransfer({
              spaceId,
              userId,
              amount,
              sourceAccountId: template.sourceAccountId,
              destinationAccountId: template.destinationAccountId,
            }),
          );
        default:
          throw new Error(`${template.type} has no record use case to compare with here`);
      }
    };
    const defined: string[] = [];
    const recorded: string[] = [];
    for (const { userId, spaceId, template } of cases) {
      defined.push(codeOf(await define(rentDefinition({ userId, spaceId, template }))));
      recorded.push(await recordedAs(userId, spaceId, template));
    }
    const expected = cases.map((c) => c.code);
    expect([defined, recorded]).toEqual([expected, expected]);
  });
});

describe("checkTemplate (ruling P21)", () => {
  const owner = { spaceId: "space-ana", creatorUserId: "u-ana" };
  const saving: RecurrenceTemplate = {
    type: "TRANSFER",
    sourceAccountId: ACCOUNTS.bancolombia.id,
    destinationAccountId: ACCOUNTS.nequi.id,
  };

  it("answers the template it was given, and refuses a transfer to the same account like RecordTransfer", async () => {
    const { deps, spaces } = recurrenceWorld();
    const members = spaces.members("space-ana");
    const loop: RecurrenceTemplate = { ...saving, destinationAccountId: ACCOUNTS.bancolombia.id };
    const checked = await checkTemplate(deps, owner, members, saving, cop(50_000n));
    expect(unwrap(checked)).toBe(saving);
    expect(codeOf(await checkTemplate(deps, owner, members, loop, cop(50_000n)))).toBe("SameAccountTransfer");
  });

  it("refuses a transfer whose two ids resolve to the same account, as the recorded transfer would", async () => {
    // PostgreSQL matches uuid columns whatever the letter case, so two spellings can be one account.
    const { deps, spaces } = recurrenceWorld();
    const caseInsensitive = { find: (id: string) => deps.accounts.find(id.toLowerCase()) };
    const loop: RecurrenceTemplate = {
      ...saving,
      destinationAccountId: ACCOUNTS.bancolombia.id.toUpperCase(),
    };
    const members = spaces.members("space-ana");
    const result = await checkTemplate(
      { ...deps, accounts: caseInsensitive },
      owner,
      members,
      loop,
      cop(50_000n),
    );
    expect(codeOf(result)).toBe("SameAccountTransfer");
  });
});

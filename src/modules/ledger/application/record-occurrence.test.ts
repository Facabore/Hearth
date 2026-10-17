import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, CATEGORIES } from "../../../../tests/support/in-memory-ledger";
import { recurrenceWorld } from "../../../../tests/support/in-memory-recurrences";
import {
  defineRecurrence,
  type Recurrence,
  type RecurrenceId,
  type RecurrenceTemplate,
} from "../domain/recurrence";
import type { Expense, Transaction } from "../domain/transaction";
import type { DefaultSplitQuery, DefaultSplitSource } from "./ports";
import { occurrenceRecorders, recordOccurrence } from "./record-occurrence";

const cop = (pesos: bigint) => money(pesos * 100n);
const day = (iso: string) => iso as LocalDate;
/** A recurrence of `spaceId` with `template`, defined by Ana; here only its space, description and template matter. */
const recurrenceOf = (template: RecurrenceTemplate, spaceId = "space-household"): Recurrence =>
  unwrap(
    defineRecurrence({
      id: "rec-1" as RecurrenceId,
      spaceId,
      description: "Monthly",
      amount: 100n,
      currency: "COP",
      template,
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: day("2026-12-01"),
      endDate: null,
      createdBy: "u-ana",
      now: new Date("2026-10-28T17:00:00Z"),
      today: day("2026-10-28"),
    }),
  );
const fromTheFund: RecurrenceTemplate = {
  type: "EXPENSE",
  categoryId: CATEGORIES.household.id,
  payer: { memberId: null, accountId: ACCOUNTS.householdFund.id },
  split: null,
};
const paidByAna: RecurrenceTemplate = {
  type: "EXPENSE",
  categoryId: CATEGORIES.household.id,
  payer: { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id },
  split: null,
};
/** An occurrence: only who it is recorded for, its date (no time) and its amount. */
const on = (userId: string, pesos: bigint, date = "2026-12-01") => ({
  userId,
  date: day(date),
  amount: cop(pesos),
});
const sharesOf = (transaction: Transaction) => (transaction as Expense).shares;

/** What every transaction recorded for Ana on 2026-12-01 carries, stamped by the world's clock (2026-10-28 noon, Bogotá). */
const recordedForAna = {
  id: "tx-1",
  description: "Monthly",
  date: "2026-12-01",
  currency: "COP",
  createdBy: "u-ana",
  createdAt: new Date("2026-10-28T17:00:00Z"),
  updatedAt: new Date("2026-10-28T17:00:00Z"),
  deletedAt: null,
  occurredAt: null,
  timeZone: null,
  version: 1,
};
const HOUSEHOLD_MEMBER_IDS = ["member-ana", "member-juan", "member-luis", "member-sofi", "member-pedro"];

/**
 * Budgeting's answer for Internet (Review Focus 4): Ana 48,000 and Juan 72,000 COP (40/60) in the ACTIVE plan of
 * 2026-12, 60,000 COP each (50/50) in the one of 2027-01; records each ask.
 */
const internetPlans = () => {
  const asked: DefaultSplitQuery[] = [];
  const defaultSplits: DefaultSplitSource = {
    allocationWeights: async (expense) => {
      asked.push(expense);
      return expense.date < "2027-01-01"
        ? [
            { memberId: "member-ana", weight: 4_800_000n },
            { memberId: "member-juan", weight: 7_200_000n },
          ]
        : [
            { memberId: "member-ana", weight: 6_000_000n },
            { memberId: "member-juan", weight: 6_000_000n },
          ];
    },
  };
  return { defaultSplits, asked };
};

describe("recordOccurrence (HU-E4-12, P21)", () => {
  it("records an expense with the template's one payer paying the whole amount, shared equally when no plan allocates it", async () => {
    const { deps, store } = recurrenceWorld();
    const recorded = await recordOccurrence(
      occurrenceRecorders(deps),
      recurrenceOf(fromTheFund),
      on("u-ana", 1_200_000n),
    );
    expect(recorded).toStrictEqual({
      ok: true,
      value: {
        transaction: {
          ...recordedForAna,
          spaceId: "space-household",
          type: "EXPENSE",
          amount: 120_000_000n,
          categoryId: CATEGORIES.household.id,
          payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: 120_000_000n }],
          shares: HOUSEHOLD_MEMBER_IDS.map((memberId) => ({
            memberId,
            amount: 24_000_000n,
            splitMethod: "EQUAL",
          })),
        },
        warnings: [],
      },
    });
    expect(store.rows).toStrictEqual([unwrap(recorded).transaction]);
  });

  it("records an income in the account of the user it records for", async () => {
    const { deps, store } = recurrenceWorld();
    const salary = recurrenceOf(
      { type: "INCOME", categoryId: CATEGORIES.salary.id, accountId: ACCOUNTS.bancolombia.id },
      "space-ana",
    );
    const recorded = await recordOccurrence(occurrenceRecorders(deps), salary, on("u-ana", 500_000n));
    expect(recorded).toStrictEqual({
      ok: true,
      value: {
        transaction: {
          ...recordedForAna,
          spaceId: "space-ana",
          type: "INCOME",
          amount: 50_000_000n,
          categoryId: CATEGORIES.salary.id,
          destinationAccountId: ACCOUNTS.bancolombia.id,
          receivingMemberId: "member-ana",
        },
        warnings: [],
      },
    });
    expect(store.rows).toStrictEqual([unwrap(recorded).transaction]);
  });

  it("records a transfer between the own accounts of the user it records for", async () => {
    const { deps, store } = recurrenceWorld();
    const saving = recurrenceOf(
      { type: "TRANSFER", sourceAccountId: ACCOUNTS.bancolombia.id, destinationAccountId: ACCOUNTS.nequi.id },
      "space-ana",
    );
    const recorded = await recordOccurrence(occurrenceRecorders(deps), saving, on("u-ana", 500_000n));
    expect(recorded).toStrictEqual({
      ok: true,
      value: {
        transaction: {
          ...recordedForAna,
          spaceId: "space-ana",
          type: "TRANSFER",
          amount: 50_000_000n,
          categoryId: null,
          sourceAccountId: ACCOUNTS.bancolombia.id,
          destinationAccountId: ACCOUNTS.nequi.id,
          payerMemberId: null,
        },
        warnings: [],
      },
    });
    expect(store.rows).toStrictEqual([unwrap(recorded).transaction]);
  });

  it("records a contribution to the shared fund from the contributor's own account, in the fund's space", async () => {
    const { deps, store } = recurrenceWorld();
    const contribution = recurrenceOf({
      type: "FUND_CONTRIBUTION",
      fundAccountId: ACCOUNTS.householdFund.id,
      memberId: "member-ana",
      sourceAccountId: ACCOUNTS.bancolombia.id,
    });
    const recorded = await recordOccurrence(occurrenceRecorders(deps), contribution, on("u-ana", 500_000n));
    expect(recorded).toStrictEqual({
      ok: true,
      value: {
        transaction: {
          ...recordedForAna,
          spaceId: "space-household",
          type: "TRANSFER",
          amount: 50_000_000n,
          categoryId: null,
          sourceAccountId: ACCOUNTS.bancolombia.id,
          destinationAccountId: ACCOUNTS.householdFund.id,
          payerMemberId: "member-ana",
        },
        warnings: [],
      },
    });
    expect(store.rows).toStrictEqual([unwrap(recorded).transaction]);
  });

  it("names the template's contributor, not the user it records for: a guest's contribution from outside the app, recorded by Juan", async () => {
    const { deps, store } = recurrenceWorld();
    const guests = recurrenceOf({
      type: "FUND_CONTRIBUTION",
      fundAccountId: ACCOUNTS.householdFund.id,
      memberId: "member-pedro",
      sourceAccountId: null,
    });
    const recorded = await recordOccurrence(occurrenceRecorders(deps), guests, on("u-juan", 500_000n));
    expect(recorded).toStrictEqual({
      ok: true,
      value: {
        transaction: {
          ...recordedForAna,
          createdBy: "u-juan",
          spaceId: "space-household",
          type: "TRANSFER",
          amount: 50_000_000n,
          categoryId: null,
          sourceAccountId: null,
          destinationAccountId: ACCOUNTS.householdFund.id,
          payerMemberId: "member-pedro",
        },
        warnings: [],
      },
    });
    expect(store.rows).toStrictEqual([unwrap(recorded).transaction]);
  });

  it("shares an expense with no split by the default split of the occurrence's own date: BY_ALLOCATION by that period's ACTIVE plan (Review Focus 4)", async () => {
    const { deps } = recurrenceWorld();
    const { defaultSplits, asked } = internetPlans();
    const recorders = occurrenceRecorders({ ...deps, defaultSplits });
    const internet = recurrenceOf(fromTheFund);
    const december = unwrap(await recordOccurrence(recorders, internet, on("u-ana", 120_000n, "2026-12-01")));
    const january = unwrap(await recordOccurrence(recorders, internet, on("u-ana", 120_000n, "2027-01-01")));
    expect([december, january].map((recorded) => sharesOf(recorded.transaction))).toStrictEqual([
      [
        { memberId: "member-ana", amount: 4_800_000n, splitMethod: "BY_ALLOCATION" },
        { memberId: "member-juan", amount: 7_200_000n, splitMethod: "BY_ALLOCATION" },
      ],
      [
        { memberId: "member-ana", amount: 6_000_000n, splitMethod: "BY_ALLOCATION" },
        { memberId: "member-juan", amount: 6_000_000n, splitMethod: "BY_ALLOCATION" },
      ],
    ]);
    // The occurrence's date reaches the default split, never the day it is recorded (2026-10-28).
    expect(asked).toStrictEqual(
      ["2026-12-01", "2027-01-01"].map((date) => ({
        spaceId: "space-household",
        currency: "COP",
        categoryId: CATEGORIES.household.id,
        date,
        memberIds: HOUSEHOLD_MEMBER_IDS,
      })),
    );
  });

  it("copies the template's explicit split as a snapshot of each occurrence's amount, and never asks for a default", async () => {
    const { deps } = recurrenceWorld();
    const { defaultSplits, asked } = internetPlans();
    const recorders = occurrenceRecorders({ ...deps, defaultSplits });
    const shared = recurrenceOf({
      ...paidByAna,
      split: {
        method: "SHARES",
        participants: [
          { memberId: "member-ana", units: 1 },
          { memberId: "member-juan", units: 3 },
        ],
      },
    });
    const estimated = unwrap(await recordOccurrence(recorders, shared, on("u-ana", 2_000_000n)));
    const confirmed = unwrap(
      await recordOccurrence(recorders, shared, on("u-ana", 1_000_000n, "2027-01-01")),
    );
    expect([estimated, confirmed].map((recorded) => sharesOf(recorded.transaction))).toStrictEqual([
      [
        { memberId: "member-ana", amount: 50_000_000n, splitMethod: "SHARES" },
        { memberId: "member-juan", amount: 150_000_000n, splitMethod: "SHARES" },
      ],
      [
        { memberId: "member-ana", amount: 25_000_000n, splitMethod: "SHARES" },
        { memberId: "member-juan", amount: 75_000_000n, splitMethod: "SHARES" },
      ],
    ]);
    expect(asked).toStrictEqual([]);
  });

  it("carries the fund's negative balance as a warning, and still records the expense (HU-E4-10)", async () => {
    const { deps, store } = recurrenceWorld();
    const recorded = unwrap(
      await recordOccurrence(occurrenceRecorders(deps), recurrenceOf(fromTheFund), on("u-ana", 2_000_000n)),
    );
    expect(recorded.warnings).toStrictEqual([
      { code: "FundBalanceNegative", accountId: ACCOUNTS.householdFund.id, balance: -50_000_000n },
    ]);
    expect(store.rows).toStrictEqual([recorded.transaction]);
  });

  it("answers what the ledger answers, unchanged: PeriodClosed in a closed period, asked for the occurrence's date", async () => {
    const { deps, store } = recurrenceWorld();
    const asked: string[] = [];
    const closed = occurrenceRecorders({
      ...deps,
      closedPeriods: {
        isClosed: async (spaceId, date) => {
          asked.push(`${spaceId} ${date}`);
          return true;
        },
      },
    });
    expect(await recordOccurrence(closed, recurrenceOf(fromTheFund), on("u-ana", 1_200_000n))).toStrictEqual({
      ok: false,
      error: { code: "PeriodClosed" },
    });
    expect(asked).toStrictEqual(["space-household 2026-12-01"]);
    expect(store.rows).toStrictEqual([]);
  });

  it("answers AccountNotOwned, unchanged, when the user is not the owner of the account the payer debits (D9, Review Focus 3)", async () => {
    const { deps, store } = recurrenceWorld();
    const recorders = occurrenceRecorders(deps);
    const anas = recurrenceOf(paidByAna);
    // Juan is an ADMIN who may record, so only D9 refuses him.
    expect(await recordOccurrence(recorders, anas, on("u-juan", 205_300n))).toStrictEqual({
      ok: false,
      error: { code: "AccountNotOwned" },
    });
    expect(store.rows).toStrictEqual([]);
    // The same occurrence recorded for Ana, who owns the account, goes through.
    expect(codeOf(await recordOccurrence(recorders, anas, on("u-ana", 205_300n)))).toBe("ok");
    expect(store.rows).toHaveLength(1);
  });

  it("applies the matrix and the archived-space rule to the user it records for, as the ledger does", async () => {
    const { deps, spaces, store } = recurrenceWorld();
    const recorders = occurrenceRecorders(deps);
    const rent = recurrenceOf(fromTheFund);
    expect(codeOf(await recordOccurrence(recorders, rent, on("u-sofi", 1_200_000n)))).toBe(
      "InsufficientRole",
    );
    expect(codeOf(await recordOccurrence(recorders, rent, on("u-nobody", 1_200_000n)))).toBe("SpaceNotFound");
    await spaces.archive("space-household");
    expect(codeOf(await recordOccurrence(recorders, rent, on("u-ana", 1_200_000n)))).toBe("SpaceArchived");
    expect(store.rows).toStrictEqual([]);
  });
});

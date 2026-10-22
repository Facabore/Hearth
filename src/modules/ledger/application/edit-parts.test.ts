import { describe, expect, it } from "vitest";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  aSettlement,
  aTransfer,
  anExpense,
  anIncome,
  householdLedger,
  ledgerFixture,
} from "../../../../tests/support/in-memory-ledger";
import type { Expense, Income, Transfer } from "../domain/transaction";
import type { LedgerDeps } from "./deps";
import { createEditTransaction, type EditChanges } from "./edit-transaction";
import { createListAudit } from "./list-audit";

const asAna = { spaceId: "space-ana", userId: "u-ana" };

const personal = (overrides: Partial<LedgerDeps> = {}) => {
  const fixture = ledgerFixture(overrides);
  const market = anExpense("2026-10-31", 8_500_000n, { description: "Market" });
  const salary = anIncome("2026-10-30", 300_000_000n);
  const move = aTransfer("2026-10-29", 50_000_000n);
  fixture.store.rows.push(market, salary, move);
  const edit = createEditTransaction(fixture.deps);
  return {
    ...fixture,
    market,
    salary,
    move,
    history: createListAudit(fixture.deps),
    change: (transactionId: string, changes: EditChanges) =>
      edit({ ...asAna, transactionId, expectedVersion: null, changes }),
  };
};

const household = (overrides: Partial<LedgerDeps> = {}) => {
  const fixture = householdLedger(undefined, overrides);
  const shared = anExpense("2026-10-20", 3_000_000n, {
    spaceId: "space-household",
    shares: [
      { memberId: "member-ana", amount: 1_500_000n, splitMethod: "EQUAL" },
      { memberId: "member-juan", amount: 1_500_000n, splitMethod: "EQUAL" },
    ],
  });
  const juans = anExpense("2026-10-21", 1_000_000n, {
    spaceId: "space-household",
    createdBy: "u-juan",
    payments: [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount: 1_000_000n }],
    shares: [{ memberId: "member-juan", amount: 1_000_000n, splitMethod: "EQUAL" }],
  });
  fixture.store.rows.push(shared, juans);
  const edit = createEditTransaction(fixture.deps);
  return {
    ...fixture,
    shared,
    juans,
    change: (userId: string, transactionId: string, changes: EditChanges) =>
      edit({ spaceId: "space-household", userId, transactionId, expectedVersion: null, changes }),
  };
};

describe("EditTransaction changes accounts and who paid (ruling P186)", () => {
  it("moves a personal expense to another of Ana's accounts and audits the payment", async () => {
    const { change, history, market } = personal();
    const edited = unwrap(await change(market.id, { accountId: ACCOUNTS.nequi.id })) as Expense;
    expect(edited.payments).toEqual([{ memberId: "member-ana", accountId: "acc-nequi", amount: 8_500_000n }]);
    expect(edited.shares.map((s) => s.amount)).toEqual([8_500_000n]);
    const [entry] = unwrap(await history({ ...asAna, transactionId: market.id }));
    expect(entry!.changes).toEqual({
      payments: {
        from: '[{"memberId":"member-ana","accountId":"acc-bancolombia","amount":"8500000"}]',
        to: '[{"memberId":"member-ana","accountId":"acc-nequi","amount":"8500000"}]',
      },
    });
  });

  it("moves the account and the amount together: the sole payment and share follow both", async () => {
    const { change, market } = personal();
    const edited = unwrap(
      await change(market.id, { accountId: ACCOUNTS.nequi.id, amount: money(9_500_000n) }),
    ) as Expense;
    expect(edited.payments).toEqual([{ memberId: "member-ana", accountId: "acc-nequi", amount: 9_500_000n }]);
    expect(edited.shares.map((s) => s.amount)).toEqual([9_500_000n]);
  });

  it("moves an income to another receiving account and audits it (P187)", async () => {
    const { change, history, salary } = personal();
    const edited = unwrap(await change(salary.id, { accountId: ACCOUNTS.nequi.id })) as Income;
    expect(edited.destinationAccountId).toBe("acc-nequi");
    const [entry] = unwrap(await history({ ...asAna, transactionId: salary.id }));
    expect(entry!.changes).toEqual({ destinationAccountId: { from: "acc-bancolombia", to: "acc-nequi" } });
  });

  it("swaps an own transfer's accounts, audits both and refuses the same account on both sides", async () => {
    const { change, history, move } = personal();
    const swapped = unwrap(
      await change(move.id, {
        sourceAccountId: ACCOUNTS.nequi.id,
        destinationAccountId: ACCOUNTS.bancolombia.id,
      }),
    ) as Transfer;
    expect([swapped.sourceAccountId, swapped.destinationAccountId]).toEqual(["acc-nequi", "acc-bancolombia"]);
    const [entry] = unwrap(await history({ ...asAna, transactionId: move.id }));
    expect(entry!.changes).toEqual({
      sourceAccountId: { from: "acc-bancolombia", to: "acc-nequi" },
      destinationAccountId: { from: "acc-nequi", to: "acc-bancolombia" },
    });
    expect(codeOf(await change(move.id, { destinationAccountId: ACCOUNTS.nequi.id }))).toBe(
      "SameAccountTransfer",
    );
  });

  it("refuses another person's account and an archived one (D9)", async () => {
    const { change, market, move, salary } = personal();
    expect(codeOf(await change(market.id, { accountId: ACCOUNTS.davivienda.id }))).toBe("AccountNotOwned");
    expect(codeOf(await change(market.id, { accountId: ACCOUNTS.oldNequi.id }))).toBe("AccountArchived");
    expect(codeOf(await change(salary.id, { accountId: ACCOUNTS.davivienda.id }))).toBe("AccountNotOwned");
    expect(codeOf(await change(salary.id, { accountId: ACCOUNTS.oldNequi.id }))).toBe("AccountArchived");
    expect(codeOf(await change(move.id, { sourceAccountId: ACCOUNTS.davivienda.id }))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await change(move.id, { destinationAccountId: ACCOUNTS.oldNequi.id }))).toBe(
      "AccountArchived",
    );
  });

  it("refuses an account of another space and one that does not exist", async () => {
    // Ana's own account, but living in a space other than the transaction's.
    const elsewhere = { ...ACCOUNTS.nequi, id: "acc-ana-elsewhere", spaceId: "space-trip" };
    const accounts = {
      find: async (id: string) => Object.values({ ...ACCOUNTS, elsewhere }).find((a) => a.id === id) ?? null,
    };
    const { change, market, move, salary } = personal({ accounts });
    expect(codeOf(await change(salary.id, { accountId: elsewhere.id }))).toBe("AccountNotInSpace");
    expect(codeOf(await change(move.id, { sourceAccountId: elsewhere.id }))).toBe("AccountNotInSpace");
    expect(codeOf(await change(move.id, { destinationAccountId: elsewhere.id }))).toBe("AccountNotInSpace");
    expect(codeOf(await change(market.id, { accountId: "acc-missing" }))).toBe("AccountNotFound");
    expect(codeOf(await change(salary.id, { accountId: "acc-missing" }))).toBe("AccountNotFound");
    expect(codeOf(await change(move.id, { sourceAccountId: "acc-missing" }))).toBe("AccountNotFound");
  });

  it("refuses parts a type does not have, and the accounts of settlements and fund contributions (P188)", async () => {
    const { change, market, move, salary, store } = personal();
    const settlement = aSettlement("2026-10-28", 1_000_000n, { spaceId: "space-ana" });
    const contribution = aTransfer("2026-10-28", 1_000_000n, { payerMemberId: "member-ana" });
    store.rows.push(settlement, contribution);
    const payments = [
      { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(300_000_000n) },
    ];
    for (const [id, changes, field] of [
      [salary.id, { payments }, "payments"],
      [salary.id, { sourceAccountId: ACCOUNTS.nequi.id }, "sourceAccountId"],
      [salary.id, { destinationAccountId: ACCOUNTS.nequi.id }, "destinationAccountId"],
      [market.id, { sourceAccountId: ACCOUNTS.nequi.id }, "sourceAccountId"],
      [market.id, { destinationAccountId: ACCOUNTS.nequi.id }, "destinationAccountId"],
      [move.id, { accountId: ACCOUNTS.nequi.id }, "accountId"],
      [move.id, { payments }, "payments"],
      [settlement.id, { accountId: ACCOUNTS.nequi.id }, "accountId"],
      [settlement.id, { payments }, "payments"],
      [settlement.id, { sourceAccountId: ACCOUNTS.bancolombia.id }, "sourceAccountId"],
      [settlement.id, { destinationAccountId: ACCOUNTS.bancolombia.id }, "destinationAccountId"],
      [contribution.id, { sourceAccountId: ACCOUNTS.nequi.id }, "sourceAccountId"],
      [contribution.id, { destinationAccountId: ACCOUNTS.bancolombia.id }, "destinationAccountId"],
    ] as const) {
      const result = await change(id, changes);
      expect(result.ok ? null : [result.error.code, result.error.details?.field]).toEqual([
        "FieldNotEditable",
        field,
      ]);
    }
  });

  it("changes who paid a shared expense: the recorder, a guest or the fund; never another member's account", async () => {
    const { change, shared } = household();
    const amount = money(3_000_000n);
    const guest = unwrap(
      await change("u-ana", shared.id, { payments: [{ memberId: "member-pedro", accountId: null, amount }] }),
    ) as Expense;
    expect(guest.payments).toEqual([{ memberId: "member-pedro", accountId: null, amount: 3_000_000n }]);
    const fund = unwrap(
      await change("u-ana", shared.id, {
        payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount }],
      }),
    ) as Expense;
    expect(fund.payments).toEqual([{ memberId: null, accountId: "acc-household-fund", amount: 3_000_000n }]);
    expect(
      codeOf(
        await change("u-ana", shared.id, {
          payments: [{ memberId: "member-juan", accountId: ACCOUNTS.davivienda.id, amount }],
        }),
      ),
    ).toBe("AccountNotOwned");
    expect(
      codeOf(
        await change("u-ana", shared.id, {
          payments: [
            { memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(2_000_000n) },
          ],
        }),
      ),
    ).toBe("SharesDoNotMatchAmount");
  });

  it("keeps an OWNER from moving a member's expense to the OWNER's own account (D9)", async () => {
    const { change, juans } = household();
    expect(codeOf(await change("u-ana", juans.id, { accountId: ACCOUNTS.bancolombia.id }))).toBe(
      "AccountNotOwned",
    );
  });

  it("refuses moving another member's income, even to the editor's own account (D9)", async () => {
    const { change, store } = personal();
    const juansIncome = anIncome("2026-10-27", 100_000_000n, {
      createdBy: "u-juan",
      receivingMemberId: "member-juan",
      destinationAccountId: ACCOUNTS.davivienda.id,
    });
    store.rows.push(juansIncome);
    expect(codeOf(await change(juansIncome.id, { accountId: ACCOUNTS.nequi.id }))).toBe("AccountNotOwned");
  });

  it("refuses moving the accounts of a transfer another member created (D9)", async () => {
    const { change, store } = personal();
    const juansMove = aTransfer("2026-10-27", 10_000_000n, { createdBy: "u-juan" });
    store.rows.push(juansMove);
    expect(
      codeOf(
        await change(juansMove.id, {
          sourceAccountId: ACCOUNTS.nequi.id,
          destinationAccountId: ACCOUNTS.bancolombia.id,
        }),
      ),
    ).toBe("AccountNotOwned");
  });

  it("keeps a member who left at zero when the payer changes (the parties check covers payments)", async () => {
    const { change, store } = household();
    const gone = anExpense("2026-10-19", 2_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 1_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-gone", amount: 1_000_000n, splitMethod: "EQUAL" },
      ],
      payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: 2_000_000n }],
    });
    store.rows.push(gone);
    const result = await change("u-ana", gone.id, {
      payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: money(2_000_000n) }],
    });
    expect(codeOf(result)).toBe("NotASpaceMember");
  });

  it("refuses making a fund-paid expense member-paid while a share names a member who left", async () => {
    const { change, store } = household();
    const rent = anExpense("2026-10-19", 2_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 1_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-gone", amount: 1_000_000n, splitMethod: "EQUAL" },
      ],
      payments: [{ memberId: null, accountId: ACCOUNTS.householdFund.id, amount: 2_000_000n }],
    });
    store.rows.push(rent);
    const result = await change("u-ana", rent.id, {
      payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: money(2_000_000n) }],
    });
    expect(codeOf(result)).toBe("NotASpaceMember");
  });

  it("changes nothing and writes no audit when the account is already the one in use", async () => {
    const { audit, change, market } = personal();
    const same = unwrap(await change(market.id, { accountId: ACCOUNTS.bancolombia.id }));
    expect(same.version).toBe(1);
    expect(audit.entries).toEqual([]);
  });
});

describe("EditTransaction changes how an expense is split (ruling P186)", () => {
  const equal = (...memberIds: string[]) => ({
    method: "EQUAL" as const,
    participants: memberIds.map((memberId) => ({ memberId })),
  });

  it("recomputes EQUAL shares on a new amount", async () => {
    const { change, shared } = household();
    const edited = unwrap(
      await change("u-ana", shared.id, {
        amount: money(4_000_000n),
        split: equal("member-ana", "member-juan"),
      }),
    ) as Expense;
    expect(edited.payments.map((p) => p.amount)).toEqual([4_000_000n]);
    expect(edited.shares.map((s) => [s.memberId, s.amount, s.splitMethod])).toEqual([
      ["member-ana", 2_000_000n, "EQUAL"],
      ["member-juan", 2_000_000n, "EQUAL"],
    ]);
  });

  it("splits by percentage on the current amount when only the split changes", async () => {
    const { change, shared } = household();
    const edited = unwrap(
      await change("u-ana", shared.id, {
        split: {
          method: "PERCENT",
          participants: [
            { memberId: "member-ana", basisPoints: 4_000 },
            { memberId: "member-juan", basisPoints: 6_000 },
          ],
        },
      }),
    ) as Expense;
    expect(edited.shares.map((s) => s.amount)).toEqual([1_200_000n, 1_800_000n]);
  });

  it("still refuses a new amount without a split when there are several shares (HU-E4-06)", async () => {
    const { change, shared } = household();
    expect(codeOf(await change("u-ana", shared.id, { amount: money(4_000_000n) }))).toBe(
      "SharesDoNotMatchAmount",
    );
  });

  it("gives no share to someone who is not a current member, and refuses a split on an income", async () => {
    const { change, shared } = household();
    expect(codeOf(await change("u-ana", shared.id, { split: equal("member-ana", "member-gone") }))).toBe(
      "NotASpaceMember",
    );
    const { change: personalChange, salary } = personal();
    const result = await personalChange(salary.id, { split: equal("member-ana") });
    expect(result.ok ? null : [result.error.code, result.error.details?.field]).toEqual([
      "FieldNotEditable",
      "split",
    ]);
  });

  it("refuses a split on a transfer, a settlement and a fund contribution as FieldNotEditable", async () => {
    const { change, move, store } = personal();
    const settlement = aSettlement("2026-10-28", 1_000_000n, { spaceId: "space-ana" });
    const contribution = aTransfer("2026-10-28", 1_000_000n, { payerMemberId: "member-ana" });
    store.rows.push(settlement, contribution);
    for (const id of [move.id, settlement.id, contribution.id]) {
      const result = await change(id, { split: equal("member-ana") });
      expect(result.ok ? null : [result.error.code, result.error.details?.field]).toEqual([
        "FieldNotEditable",
        "split",
      ]);
    }
  });

  it("applies the recording rules: the shares must sum to the amount and the participants be valid", async () => {
    const { change, shared, store } = household();
    const attempt = async (split: EditChanges["split"]) => {
      const result = await change("u-ana", shared.id, { split });
      return result.ok ? null : [result.error.code, result.error.details?.reason ?? null];
    };
    expect(
      await attempt({
        method: "EXACT",
        participants: [
          { memberId: "member-ana", amount: money(1_000_000n) },
          { memberId: "member-juan", amount: money(1_000_000n) },
        ],
      }),
    ).toEqual(["SharesDoNotMatchAmount", null]);
    expect(
      await attempt({
        method: "PERCENT",
        participants: [
          { memberId: "member-ana", basisPoints: 4_000 },
          { memberId: "member-juan", basisPoints: 5_000 },
        ],
      }),
    ).toEqual(["InvalidSplit", "percentNotHundred"]);
    expect(await attempt(equal("member-ana", "member-ana"))).toEqual([
      "InvalidSplit",
      "duplicateParticipant",
    ]);
    expect(await attempt({ method: "EQUAL", participants: [] })).toEqual(["ParticipantsRequired", null]);
    expect(
      await attempt({
        method: "SHARES",
        participants: [
          { memberId: "member-ana", units: 2 },
          { memberId: "member-juan", units: 0 },
        ],
      }),
    ).toEqual(["InvalidSplit", "unitsNotPositive"]);
    // Nothing was saved by the refusals.
    expect((store.rows.find((row) => row.id === shared.id) as Expense).version).toBe(1);
  });

  it("accepts an EXACT split that adds up to the new amount", async () => {
    const { change, shared } = household();
    const edited = unwrap(
      await change("u-ana", shared.id, {
        amount: money(4_000_000n),
        split: {
          method: "EXACT",
          participants: [
            { memberId: "member-ana", amount: money(1_000_000n) },
            { memberId: "member-juan", amount: money(3_000_000n) },
          ],
        },
      }),
    ) as Expense;
    expect(edited.shares.map((s) => [s.memberId, s.amount, s.splitMethod])).toEqual([
      ["member-ana", 1_000_000n, "EXACT"],
      ["member-juan", 3_000_000n, "EXACT"],
    ]);
  });

  it("audits the old and the new shares as JSON, and nothing else when only the split changes", async () => {
    const { change, shared, store, audit } = household();
    unwrap(
      await change("u-ana", shared.id, {
        split: {
          method: "PERCENT",
          participants: [
            { memberId: "member-ana", basisPoints: 4_000 },
            { memberId: "member-juan", basisPoints: 6_000 },
          ],
        },
      }),
    );
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]!.action).toBe("UPDATED");
    expect(audit.entries[0]!.changes).toEqual({
      shares: {
        from: '[{"memberId":"member-ana","amount":"1500000","splitMethod":"EQUAL"},{"memberId":"member-juan","amount":"1500000","splitMethod":"EQUAL"}]',
        to: '[{"memberId":"member-ana","amount":"1200000","splitMethod":"PERCENT"},{"memberId":"member-juan","amount":"1800000","splitMethod":"PERCENT"}]',
      },
    });
    const saved = store.rows.find((row) => row.id === shared.id) as Expense;
    expect(saved.version).toBe(2);
    expect(saved.shares.map((s) => s.amount)).toEqual([1_200_000n, 1_800_000n]);
  });

  it("changes nothing and writes no audit when the split is the one already stored", async () => {
    const { change, shared, audit } = household();
    const same = unwrap(await change("u-ana", shared.id, { split: equal("member-ana", "member-juan") }));
    expect(same.version).toBe(1);
    expect(audit.entries).toEqual([]);
  });

  it("never reapplies the plan's default split when no split is sent (P186, spec 5.3)", async () => {
    let asked = 0;
    const defaultSplits = {
      allocationWeights: async () => {
        asked += 1;
        return [
          { memberId: "member-ana", weight: 1n },
          { memberId: "member-juan", weight: 3n },
        ];
      },
    };
    const { change, store } = household({ defaultSplits });
    const planned = anExpense("2026-10-18", 4_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 2_000_000n, splitMethod: "BY_ALLOCATION" },
        { memberId: "member-juan", amount: 2_000_000n, splitMethod: "BY_ALLOCATION" },
      ],
    });
    store.rows.push(planned);
    const renamed = unwrap(await change("u-ana", planned.id, { description: "Market" })) as Expense;
    expect(renamed.shares).toEqual(planned.shares);
    // Changing the amount alone is refused, not silently re-split by the plan.
    expect(codeOf(await change("u-ana", planned.id, { amount: money(5_000_000n) }))).toBe(
      "SharesDoNotMatchAmount",
    );
    expect(asked).toBe(0);
  });

  it("keeps a member who left at zero: no split edit and no amount edit may move their share", async () => {
    const { change, store } = household();
    const gone = anExpense("2026-10-19", 2_000_000n, {
      spaceId: "space-household",
      shares: [
        { memberId: "member-ana", amount: 1_000_000n, splitMethod: "EQUAL" },
        { memberId: "member-gone", amount: 1_000_000n, splitMethod: "EQUAL" },
      ],
      payments: [{ memberId: "member-ana", accountId: ACCOUNTS.bancolombia.id, amount: 2_000_000n }],
    });
    store.rows.push(gone);
    // Dropping the departed member from the split would move their balance.
    expect(codeOf(await change("u-ana", gone.id, { split: equal("member-ana") }))).toBe("NotASpaceMember");
    expect(
      codeOf(await change("u-ana", gone.id, { amount: money(3_000_000n), split: equal("member-ana") })),
    ).toBe("NotASpaceMember");
    // The same split on the unchanged amount: still refused, since the departed member's share would be dropped.
    expect(codeOf(await change("u-ana", gone.id, { split: equal("member-ana", "member-juan") }))).toBe(
      "NotASpaceMember",
    );
    expect((store.rows.find((row) => row.id === gone.id) as Expense).version).toBe(1);
  });

  it("lets a MEMBER split only their own expense, an ADMIN any, and a VIEWER none", async () => {
    const { change, shared, store } = household();
    const split = equal("member-ana", "member-juan");
    expect(codeOf(await change("u-luis", shared.id, { split }))).toBe("InsufficientRole");
    expect(codeOf(await change("u-sofi", shared.id, { split }))).toBe("InsufficientRole");
    const lucia = anExpense("2026-10-17", 1_000_000n, {
      spaceId: "space-household",
      createdBy: "u-luis",
      payments: [{ memberId: "member-luis", accountId: null, amount: 1_000_000n }],
      shares: [{ memberId: "member-luis", amount: 1_000_000n, splitMethod: "EQUAL" }],
    });
    store.rows.push(lucia);
    const own = unwrap(
      await change("u-luis", lucia.id, { split: equal("member-luis", "member-ana") }),
    ) as Expense;
    expect(own.shares.map((s) => s.amount)).toEqual([500_000n, 500_000n]);
    expect(unwrap(await change("u-juan", shared.id, { split })).version).toBe(1);
  });
});

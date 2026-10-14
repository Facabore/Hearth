import { describe, expect, it } from "vitest";
import type { LocalDate } from "@/shared/kernel";
import { codeOf, money, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, householdLedger, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { createRecordFundContribution, type RecordFundContributionInput } from "./record-fund-contribution";

/** HU-E4-09: Ana transfers 480,000 COP from Bancolombia to Household Fund on 2026-10-02. */
const contribution = (overrides: Partial<RecordFundContributionInput> = {}): RecordFundContributionInput => ({
  spaceId: "space-household",
  userId: "u-ana",
  description: "October",
  date: "2026-10-02" as LocalDate,
  amount: money(48_000_000n),
  fundAccountId: ACCOUNTS.householdFund.id,
  sourceAccountId: ACCOUNTS.bancolombia.id,
  ...overrides,
});

describe("RecordFundContribution (HU-E4-09)", () => {
  it("records Ana's contribution from her own account as a TRANSFER into the fund of Household", async () => {
    const { deps, store } = householdLedger();
    expect(unwrap(await createRecordFundContribution(deps)(contribution()))).toMatchObject({
      type: "TRANSFER",
      spaceId: "space-household",
      categoryId: null,
      amount: 48_000_000n,
      sourceAccountId: "acc-bancolombia",
      destinationAccountId: "acc-household-fund",
      payerMemberId: "member-ana",
      createdBy: "u-ana",
    });
    expect(store.netOf(ACCOUNTS.householdFund.id)).toBe(48_000_000n);
    expect(store.netOf(ACCOUNTS.bancolombia.id)).toBe(-48_000_000n);
  });

  it("requires the contributor's own account, debited only by its owner (D9)", async () => {
    const { deps, store } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    expect(codeOf(await contribute(contribution({ sourceAccountId: ACCOUNTS.davivienda.id })))).toBe(
      "AccountNotOwned",
    );
    expect(codeOf(await contribute(contribution({ sourceAccountId: null })))).toBe("AccountRequired");
    // Ana cannot record a contribution that debits Juan's account; Juan records it himself.
    const juans = { memberId: "member-juan", sourceAccountId: ACCOUNTS.davivienda.id };
    expect(codeOf(await contribute(contribution(juans)))).toBe("AccountNotOwned");
    expect(store.rows).toEqual([]);
    expect(codeOf(await contribute(contribution({ ...juans, userId: "u-juan" })))).toBe("ok");
    expect(store.rows).toMatchObject([{ payerMemberId: "member-juan", createdBy: "u-juan" }]);
  });

  it("does not let a viewer contribute", async () => {
    const { deps } = householdLedger();
    expect(codeOf(await createRecordFundContribution(deps)(contribution({ userId: "u-sofi" })))).toBe(
      "InsufficientRole",
    );
  });

  it("records a guest's contribution from outside the app", async () => {
    const { deps } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    const byPedro = contribution({ memberId: "member-pedro", sourceAccountId: null });
    expect(unwrap(await contribute(byPedro))).toMatchObject({
      payerMemberId: "member-pedro",
      sourceAccountId: null,
      createdBy: "u-ana",
    });
    expect(codeOf(await contribute({ ...byPedro, sourceAccountId: ACCOUNTS.bancolombia.id }))).toBe(
      "GuestHasNoAccounts",
    );
  });

  it("accepts only this space's own shared fund (Review Focus 3)", async () => {
    const { deps, store } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    expect(codeOf(await contribute(contribution({ fundAccountId: ACCOUNTS.tripFund.id })))).toBe(
      "AccountNotFound",
    );
    expect(codeOf(await contribute(contribution({ fundAccountId: "not-a-uuid" })))).toBe("AccountNotFound");
    expect(codeOf(await contribute(contribution({ fundAccountId: ACCOUNTS.oldFund.id })))).toBe(
      "AccountArchived",
    );
    expect(store.rows).toEqual([]);
    const personal = ledgerFixture();
    const intoOwnBank = contribution({
      spaceId: "space-ana",
      fundAccountId: ACCOUNTS.bancolombia.id,
      sourceAccountId: ACCOUNTS.nequi.id,
    });
    expect(codeOf(await createRecordFundContribution(personal.deps)(intoOwnBank))).toBe("InvalidFundAccount");
  });

  it("rejects contributors who are not members and non-positive amounts (Review Focus 2)", async () => {
    const { deps } = householdLedger();
    const contribute = createRecordFundContribution(deps);
    expect(codeOf(await contribute(contribution({ memberId: "member-marta" })))).toBe("NotASpaceMember");
    expect(codeOf(await contribute(contribution({ amount: money(0n) })))).toBe("InvalidAmount");
  });
});

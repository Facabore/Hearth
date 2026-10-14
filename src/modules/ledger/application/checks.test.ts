import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { ACCOUNTS, ledgerFixture } from "../../../../tests/support/in-memory-ledger";
import { HOUSEHOLD_MEMBERS } from "../../../../tests/support/in-memory-spaces";
import { partyAccount } from "./checks";

describe("partyAccount (spec 5.2, D9)", () => {
  const { deps } = ledgerFixture();

  it("debits a personal account only for its owner and credits it for anyone (null debitedBy)", async () => {
    const juans = (debitedBy: string | null) =>
      partyAccount(deps, HOUSEHOLD_MEMBERS, "member-juan", ACCOUNTS.davivienda.id, {
        required: true,
        debitedBy,
      });
    expect(codeOf(await juans("u-ana"))).toBe("AccountNotOwned");
    expect(unwrap(await juans("u-juan"))).toBe(ACCOUNTS.davivienda.id);
    expect(unwrap(await juans(null))).toBe(ACCOUNTS.davivienda.id);
  });

  it("makes every caller say whether it debits, so no debit path can skip D9", () => {
    // Never called: tsc checks that leaving debitedBy out does not compile.
    const omitted = () =>
      // @ts-expect-error debitedBy is required: the requester's user for a debit, null for a credit.
      partyAccount(deps, HOUSEHOLD_MEMBERS, "member-juan", ACCOUNTS.davivienda.id, { required: true });
    expect(omitted).toBeTypeOf("function");
  });
});

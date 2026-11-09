import { describe, expect, it } from "vitest";
import { preferredAccountId } from "./last-account";

const account = (id: string, type: string, pesos: number) => ({
  id,
  type: type as "BANK",
  balance: { amount: String(BigInt(pesos) * 100n), currency: "COP" },
});

/** The five starter accounts in list order, as a new person has them (audit pass 3, A8). */
const starters = (cash = 0) => [
  account("savings", "SAVINGS", 0),
  account("wallet", "WALLET", 0),
  account("bank", "BANK", 0),
  account("cash", "CASH", cash),
  account("card", "CREDIT_CARD", 0),
];

describe("the account a new movement starts on (#208, #285)", () => {
  it("keeps the one this browser last paid from while it is offered", () => {
    expect(preferredAccountId(starters(100_000), "bank")).toBe("bank");
  });

  it("with none remembered, starts where the money is: the non-savings account with the highest balance (#285)", () => {
    expect(preferredAccountId(starters(100_000), null)).toBe("cash");
    expect(
      preferredAccountId(
        [
          account("wallet", "WALLET", 0),
          account("davivienda", "BANK", 2_000_000),
          account("cash", "CASH", 0),
        ],
        "archived",
      ),
    ).toBe("davivienda");
  });

  it("never picks a savings account for its balance alone", () => {
    expect(
      preferredAccountId([account("savings", "SAVINGS", 9_000_000), account("wallet", "WALLET", 0)], null),
    ).toBe("wallet");
  });

  it("keeps the list order when every balance is the same, and falls back to the first account", () => {
    expect(preferredAccountId(starters(), null)).toBe("wallet");
    expect(preferredAccountId([account("savings", "SAVINGS", 0)], null)).toBe("savings");
    expect(preferredAccountId([], null)).toBeNull();
  });

  it("reads an account without a balance as zero", () => {
    expect(preferredAccountId([{ id: "a", type: "BANK" }, account("b", "CASH", 5_000)], null)).toBe("b");
  });
});

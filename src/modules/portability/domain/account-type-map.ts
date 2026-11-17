import type { SourceAccountType } from "./source-snapshot";

/** Money Manager's `ASSETGROUP.TYPE` of its Loan group. */
export const LOAN_GROUP_TYPE = 5;

/**
 * The Hearth type a Money Manager account group's `TYPE` maps to (design §2.1, P337: the group row's TYPE, never its
 * uid). Type 5 (Loan) depends on the sign of the account's balance (gap G4): a negative balance is money owed (`LOAN`),
 * a positive one money lent (`OTHER`, until HU-E8-15 exists). An unknown type falls back to `OTHER`.
 */
export const accountTypeForGroup = (groupType: number, balanceNegative: boolean): SourceAccountType => {
  switch (groupType) {
    case 1: // Accounts
    case 3: // Debit Card — Hearth has no separate debit card
    case 9: // Overdrafts — a negative balance is allowed on a BANK account
      return "BANK";
    case 2: // Card
      return "CREDIT_CARD";
    case 4: // Savings
      return "SAVINGS";
    case 5: // Loan
      return balanceNegative ? "LOAN" : "OTHER";
    case 6: // Top-Up/Prepaid
      return "WALLET";
    case 8: // Investments
      return "INVESTMENT";
    case 11: // Cash
      return "CASH";
    default: // 7 Others, 10 Insurance, and anything unexpected
      return "OTHER";
  }
};

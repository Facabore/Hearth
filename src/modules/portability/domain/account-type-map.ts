import type { SourceAccountType } from "./source-snapshot";

/**
 * The Hearth type a Money Manager account group maps to (design §2.1). Group 5 (Loan) depends on the sign of the
 * account's balance (gap G4): a negative balance is money owed (`LOAN`), a positive one money lent (`OTHER`, until
 * HU-E8-15 exists). An unknown group falls back to `OTHER`.
 */
export const accountTypeForGroup = (groupUid: number, balanceNegative: boolean): SourceAccountType => {
  switch (groupUid) {
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

/** HU-E2-01, HU-E2-05: every account type; all but SHARED_FUND are personal (HU-E2-02). The type never changes. */
export const ACCOUNT_TYPES = [
  "CASH",
  "BANK",
  "WALLET",
  "CREDIT_CARD",
  "SAVINGS",
  "INVESTMENT",
  "LOAN",
  "OTHER",
  "SHARED_FUND",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

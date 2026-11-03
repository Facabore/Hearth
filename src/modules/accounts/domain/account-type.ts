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

/** #240, ruling P295: what kind of product a bank account is ("Ahorros", "Corriente"), a closed list. */
export const ACCOUNT_PRODUCT_TYPES = ["SAVINGS_ACCOUNT", "CHECKING_ACCOUNT"] as const;
export type AccountProductType = (typeof ACCOUNT_PRODUCT_TYPES)[number];

const PRODUCT_TYPES: Readonly<Partial<Record<AccountType, readonly AccountProductType[]>>> = {
  BANK: ACCOUNT_PRODUCT_TYPES,
};

/** Ruling P295: the product types an account of `type` may take; none for every type but BANK. */
export const productTypesOf = (type: AccountType): readonly AccountProductType[] => PRODUCT_TYPES[type] ?? [];

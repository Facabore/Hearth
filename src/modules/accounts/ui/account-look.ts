import type { PaletteKey } from "@/shared/kernel/style";
import type { AccountDto } from "@/shared/ui/api/dto";

export type AccountType = AccountDto["type"];
export type AccountIcon = AccountDto["icon"];
export type AccountProductType = NonNullable<AccountDto["productType"]>;

/** Ruling P295: a bank account's products, in the API's order (`ACCOUNT_PRODUCT_TYPES`, pinned by a test). */
export const PRODUCT_TYPE_CHOICES = [
  "SAVINGS_ACCOUNT",
  "CHECKING_ACCOUNT",
] as const satisfies readonly AccountProductType[];

/** Issue 169: the icons an account may take, in the API's order (`ACCOUNT_ICONS`, pinned by a test). */
export const ACCOUNT_ICON_CHOICES = [
  "cash",
  "bank",
  "wallet",
  "card",
  "piggy",
  "trend",
  "coins",
  "dots",
  "users",
  "briefcase",
  "car",
  "star",
  "gift",
  "home",
  "plane",
  "phone",
] as const satisfies readonly AccountIcon[];

/** The look of an account without a color of its own, from the Accounts artboard (UI only, ruling P131). */
export const TYPE_COLORS: Readonly<Record<AccountType, PaletteKey>> = {
  CASH: "PINE",
  BANK: "STEEL",
  WALLET: "PINE",
  CREDIT_CARD: "PLUM",
  SAVINGS: "SAND",
  INVESTMENT: "SAND",
  LOAN: "EMBER",
  OTHER: "GRAPHITE",
  SHARED_FUND: "TEAL",
};

export const colorOf = (account: Pick<AccountDto, "type" | "color">): PaletteKey =>
  account.color ?? TYPE_COLORS[account.type];

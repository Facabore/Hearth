import type { PaletteKey } from "@/shared/kernel/style";
import type { AccountDto } from "@/shared/ui/api/dto";

export type AccountType = AccountDto["type"];

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

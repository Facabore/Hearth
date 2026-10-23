import { catalogLanguage } from "@/shared/kernel/catalog-language";
import type { AccountType } from "./account-type";

interface Names {
  readonly es: string;
  readonly en: string;
}

/**
 * Issue 169: the accounts every new personal space starts with, so a person can record from minute one. They open
 * at zero with no attributes (the type's default icon and switches) and no brand names; names become user data, like
 * the default categories' (HU-E3-01). Ordered by the Accounts screen's sections (ruling P131).
 */
export const STARTER_ACCOUNTS: readonly { readonly type: AccountType; readonly names: Names }[] = [
  { type: "CASH", names: { es: "Efectivo", en: "Cash" } },
  { type: "BANK", names: { es: "Cuenta bancaria", en: "Bank account" } },
  { type: "WALLET", names: { es: "Billetera digital", en: "Digital wallet" } },
  { type: "CREDIT_CARD", names: { es: "Tarjeta de crédito", en: "Credit card" } },
  { type: "SAVINGS", names: { es: "Ahorros", en: "Savings" } },
];

/** The starter accounts' names and types in `locale`. */
export const starterAccountsIn = (
  locale: string,
): readonly { readonly name: string; readonly type: AccountType }[] => {
  const language = catalogLanguage(locale);
  return STARTER_ACCOUNTS.map((starter) => ({ name: starter.names[language], type: starter.type }));
};

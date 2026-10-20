import {
  domainError,
  err,
  ok,
  PALETTE,
  type Id,
  type PaletteKey,
  type Result,
  type SymbolName,
} from "@/shared/kernel";
import type { AccountType } from "./account-type";
import { NO_TERMS, revisedTerms, type AccountTerms, type TermsChange } from "./account-terms";

export { ACCOUNT_TYPES, type AccountType } from "./account-type";

export type AccountId = Id<"Account">;

/** HU-E2-05, ruling P122: an account takes any key of the app's one palette. */
export const ACCOUNT_COLORS = PALETTE;
export type AccountColor = PaletteKey;

/** HU-E2-05, rulings P50 and P122: allow-listed Hearth symbols: each type's default plus a few household ones. */
export const ACCOUNT_ICONS = [
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
] as const satisfies readonly SymbolName[];
export type AccountIcon = (typeof ACCOUNT_ICONS)[number];

const DEFAULT_ICONS: Readonly<Record<AccountType, AccountIcon>> = {
  CASH: "cash",
  BANK: "bank",
  WALLET: "wallet",
  CREDIT_CARD: "card",
  SAVINGS: "piggy",
  INVESTMENT: "trend",
  LOAN: "coins",
  OTHER: "dots",
  SHARED_FUND: "users",
};

/**
 * HU-E2-05: optional attributes common to every type, SHARED_FUND included. The domain keeps what it is
 * given; each field names where its rule is enforced.
 */
export interface AccountAttributes {
  /** 1–60 characters, refused by the HTTP contract (Task 13); the UI may suggest a Colombian catalog. */
  readonly institution: string | null;
  /**
   * Exactly four digits, never a full number: refused by the HTTP contract (Task 13) and by the
   * `accounts_last_four` check in PostgreSQL.
   */
  readonly lastFour: string | null;
  /** One of `ACCOUNT_COLORS`: refused by the HTTP contract (Task 13); PostgreSQL does not check it. */
  readonly color: AccountColor | null;
  /**
   * One of `ACCOUNT_ICONS`: refused by the HTTP contract (Task 13); PostgreSQL does not check it. Null is the
   * type's default (`iconOf`, ruling P50).
   */
  readonly icon: AccountIcon | null;
  /** HU-E2-07, ruling P51: null means the type's default (`switchesOf`). */
  readonly includeInAvailable: boolean | null;
  readonly includeInNetWorth: boolean | null;
}

/** Every optional field of an account, unset: the common attributes (HU-E2-05) and the terms (HU-E2-06). */
export const NO_ATTRIBUTES: AccountAttributes & { readonly terms: AccountTerms } = {
  institution: null,
  lastFour: null,
  color: null,
  icon: null,
  includeInAvailable: null,
  includeInNetWorth: null,
  terms: NO_TERMS,
};

/** Undefined keeps an attribute, null clears it. */
export type AttributeChanges = { readonly [K in keyof AccountAttributes]?: AccountAttributes[K] };

const withChanges = (current: AccountAttributes, change: AttributeChanges): AccountAttributes => ({
  institution: change.institution === undefined ? current.institution : change.institution,
  lastFour: change.lastFour === undefined ? current.lastFour : change.lastFour,
  color: change.color === undefined ? current.color : change.color,
  icon: change.icon === undefined ? current.icon : change.icon,
  includeInAvailable:
    change.includeInAvailable === undefined ? current.includeInAvailable : change.includeInAvailable,
  includeInNetWorth:
    change.includeInNetWorth === undefined ? current.includeInNetWorth : change.includeInNetWorth,
});

/** HU-E2-05: the icon an account shows. */
export const iconOf = (account: Pick<Account, "type" | "icon">): AccountIcon =>
  account.icon ?? DEFAULT_ICONS[account.type];

type HostSpaceKind = "PERSONAL" | "SHARED" | "DIRECT";

export interface Account extends AccountAttributes {
  readonly id: AccountId;
  readonly spaceId: string;
  readonly name: string;
  readonly type: AccountType;
  /** Null only for SHARED_FUND accounts (HU-E2-02). */
  readonly ownerUserId: string | null;
  /** Minor units of the space currency; may be negative (credit cards). */
  readonly openingBalance: bigint;
  /** HU-E2-06: the type's terms; all null for a type without any. */
  readonly terms: AccountTerms;
  readonly archivedAt: Date | null;
  readonly createdAt: Date;
}

const MAX_NAME = 60;

const nameOf = (raw: string): Result<string> => {
  const name = raw.trim();
  return name.length >= 1 && name.length <= MAX_NAME
    ? ok(name)
    : err(domainError("InvalidAccountName", { length: name.length }));
};

/** HU-E2-01: unique per space ignoring case; archived accounts keep their names. */
const nameTaken = (siblings: readonly Account[], name: string, exceptId?: string): boolean =>
  siblings.some((a) => a.id !== exceptId && a.name.toLowerCase() === name.toLowerCase());

export const openAccount = (input: {
  id: AccountId;
  spaceId: string;
  spaceKind: HostSpaceKind;
  ownerUserId: string;
  name: string;
  type: AccountType;
  openingBalance: bigint;
  now: Date;
  siblings: readonly Account[];
  attributes?: AttributeChanges;
  terms?: TermsChange;
}): Result<Account> => {
  const name = nameOf(input.name);
  if (!name.ok) return name;
  // Spec 5.2 and HU-E2-02: SHARED_FUND <=> shared space and no owner; every other type is personal.
  if (input.type === "SHARED_FUND" && input.spaceKind !== "SHARED") {
    return err(domainError("SharedFundRequiresSharedSpace"));
  }
  if (input.type !== "SHARED_FUND" && input.spaceKind !== "PERSONAL") {
    return err(domainError("PersonalAccountRequiresPersonalSpace"));
  }
  if (nameTaken(input.siblings, name.value)) return err(domainError("AccountNameTaken"));
  const terms = revisedTerms(input.type, NO_TERMS, input.terms ?? {});
  if (!terms.ok) return terms;
  return ok({
    id: input.id,
    spaceId: input.spaceId,
    name: name.value,
    type: input.type,
    ownerUserId: input.type === "SHARED_FUND" ? null : input.ownerUserId,
    openingBalance: input.openingBalance,
    archivedAt: null,
    createdAt: input.now,
    ...withChanges(NO_ATTRIBUTES, input.attributes ?? {}),
    terms: terms.value,
  });
};

/**
 * HU-E2-03 and HU-E2-05: rename, correct the opening balance, and change or clear the common attributes
 * (undefined keeps one, null clears it); the type never changes.
 */
export const reviseAccount = (
  account: Account,
  change: {
    readonly name?: string;
    readonly type?: AccountType;
    readonly openingBalance?: bigint;
    readonly attributes?: AttributeChanges;
    readonly terms?: TermsChange;
  },
  siblings: readonly Account[],
): Result<Account> => {
  if (change.type !== undefined && change.type !== account.type)
    return err(domainError("AccountTypeImmutable"));
  const name = change.name === undefined ? ok(account.name) : nameOf(change.name);
  if (!name.ok) return name;
  if (nameTaken(siblings, name.value, account.id)) return err(domainError("AccountNameTaken"));
  const terms = revisedTerms(account.type, account.terms, change.terms ?? {});
  if (!terms.ok) return terms;
  return ok({
    ...account,
    name: name.value,
    openingBalance: change.openingBalance ?? account.openingBalance,
    ...withChanges(account, change.attributes ?? {}),
    terms: terms.value,
  });
};

/** HU-E2-03: archived accounts keep their history but take no new movements. */
export const archiveAccount = (account: Account, now: Date): Account =>
  account.archivedAt === null ? { ...account, archivedAt: now } : account;

/** HU-E2-07: types that count in available money by default; every type counts in net worth by default. */
const AVAILABLE_BY_DEFAULT: ReadonlySet<AccountType> = new Set(["CASH", "BANK", "WALLET", "SHARED_FUND"]);

/** HU-E2-07, ruling P51: the switches an account shows: the chosen value, else the type's default. */
export const switchesOf = (account: Pick<Account, "type" | "includeInAvailable" | "includeInNetWorth">) => ({
  includeInAvailable: account.includeInAvailable ?? AVAILABLE_BY_DEFAULT.has(account.type),
  includeInNetWorth: account.includeInNetWorth ?? true,
});

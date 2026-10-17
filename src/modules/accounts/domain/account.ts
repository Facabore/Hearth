import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";
import type { AccountType } from "./account-type";

export { ACCOUNT_TYPES, type AccountType } from "./account-type";

export type AccountId = Id<"Account">;

/** HU-E2-05: the palette keys an account may take. */
export const ACCOUNT_COLORS = [
  "pine",
  "ember",
  "sand",
  "sky",
  "plum",
  "moss",
  "clay",
  "slate",
  "gold",
  "rose",
] as const;
export type AccountColor = (typeof ACCOUNT_COLORS)[number];

/** HU-E2-05, ruling P50: allow-listed Lucide names: each type's default plus a few household ones. */
export const ACCOUNT_ICONS = [
  "banknote",
  "landmark",
  "wallet",
  "credit-card",
  "piggy-bank",
  "trending-up",
  "hand-coins",
  "circle-ellipsis",
  "users",
  "briefcase",
  "car",
  "gem",
  "gift",
  "house",
  "plane",
  "smartphone",
] as const;
export type AccountIcon = (typeof ACCOUNT_ICONS)[number];

const DEFAULT_ICONS: Readonly<Record<AccountType, AccountIcon>> = {
  CASH: "banknote",
  BANK: "landmark",
  WALLET: "wallet",
  CREDIT_CARD: "credit-card",
  SAVINGS: "piggy-bank",
  INVESTMENT: "trending-up",
  LOAN: "hand-coins",
  OTHER: "circle-ellipsis",
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
}

/** Every optional field of an account, unset. */
export const NO_ATTRIBUTES: AccountAttributes = {
  institution: null,
  lastFour: null,
  color: null,
  icon: null,
};

/** Undefined keeps an attribute, null clears it. */
export type AttributeChanges = { readonly [K in keyof AccountAttributes]?: AccountAttributes[K] };

const withChanges = (current: AccountAttributes, change: AttributeChanges): AccountAttributes => ({
  institution: change.institution === undefined ? current.institution : change.institution,
  lastFour: change.lastFour === undefined ? current.lastFour : change.lastFour,
  color: change.color === undefined ? current.color : change.color,
  icon: change.icon === undefined ? current.icon : change.icon,
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
  });
};

/** HU-E2-03: rename or correct the opening balance; the type never changes. */
export const reviseAccount = (
  account: Account,
  change: {
    readonly name?: string;
    readonly type?: AccountType;
    readonly openingBalance?: bigint;
    readonly attributes?: AttributeChanges;
  },
  siblings: readonly Account[],
): Result<Account> => {
  if (change.type !== undefined && change.type !== account.type)
    return err(domainError("AccountTypeImmutable"));
  const name = change.name === undefined ? ok(account.name) : nameOf(change.name);
  if (!name.ok) return name;
  if (nameTaken(siblings, name.value, account.id)) return err(domainError("AccountNameTaken"));
  return ok({
    ...account,
    name: name.value,
    openingBalance: change.openingBalance ?? account.openingBalance,
    ...withChanges(account, change.attributes ?? {}),
  });
};

/** HU-E2-03: archived accounts keep their history but take no new movements. */
export const archiveAccount = (account: Account, now: Date): Account =>
  account.archivedAt === null ? { ...account, archivedAt: now } : account;

import { domainError, err, ok, type Id, type Result } from "@/shared/kernel";

export type AccountId = Id<"Account">;
export const ACCOUNT_TYPES = ["CASH", "BANK", "CREDIT_CARD", "SAVINGS", "SHARED_FUND"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
type HostSpaceKind = "PERSONAL" | "SHARED" | "DIRECT";

export interface Account {
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
  });
};

/** HU-E2-03: rename or correct the opening balance; the type never changes. */
export const reviseAccount = (
  account: Account,
  change: { readonly name?: string; readonly type?: AccountType; readonly openingBalance?: bigint },
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
  });
};

/** HU-E2-03: archived accounts keep their history but take no new movements. */
export const archiveAccount = (account: Account, now: Date): Account =>
  account.archivedAt === null ? { ...account, archivedAt: now } : account;

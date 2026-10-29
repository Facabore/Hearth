import type { AccountDto } from "@/shared/ui/api/dto";

const KEY = "hearth.lastAccount";

/**
 * Issue #208: the account this browser last paid an expense from, or null; a blocked storage reads as none. One key for
 * every space, because a shared expense is paid from the recorder's personal accounts too.
 */
export const readLastAccount = (storage: Storage | undefined): string | null => {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
};

/** Remembers the account an expense was paid from; a full or blocked storage only loses the convenience. */
export const rememberLastAccount = (storage: Storage | undefined, accountId: string): void => {
  try {
    storage?.setItem(KEY, accountId);
  } catch {
    // Nothing to do: the next form starts on its fallback.
  }
};

/**
 * The account a new movement starts on (issue #208): the one last paid from while the form still offers it, else the
 * first that is not a savings account, else the first. Never a savings account by alphabetical accident.
 */
export const preferredAccountId = (
  accounts: readonly Pick<AccountDto, "id" | "type">[],
  lastAccountId: string | null,
): string | null =>
  (accounts.find((a) => a.id === lastAccountId) ?? accounts.find((a) => a.type !== "SAVINGS") ?? accounts[0])
    ?.id ?? null;

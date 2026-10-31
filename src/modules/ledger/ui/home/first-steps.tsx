import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useId, useState } from "react";
import { Icon } from "@/shared/ui";
import type { AccountDto, LineDashboardDto, SpaceDto, TransactionPageDto } from "@/shared/ui/api/dto";
import { withReturnTo } from "@/shared/ui/navigation/auth-redirect";
import { safeStorage } from "../record/safe-storage";

/** Issues #220 (F14) and #152: which of a new person's four first steps are already done. */
export interface FirstStepsDone {
  readonly balances: boolean;
  readonly expense: boolean;
  readonly share: boolean;
  readonly plan: boolean;
}

const moved = (account: Pick<AccountDto, "openingBalance" | "balance">) =>
  BigInt(account.balance.amount) !== BigInt(account.openingBalance.amount);

/**
 * Derived from what the personal home already reads (P265): an account opened with money or that has moved says the
 * balances are set; a movement this period, or an account that moved in any period, says the first one is recorded;
 * membership of a SHARED space says the person shares with a household (a direct split alone is not a household); a
 * plan of the period with at least one line, whatever its status, says the month's plan is set up (#152). A plan not
 * read yet, or that could not be read, counts as not set up.
 */
export const firstStepsOf = ({
  accounts,
  page,
  spaces,
  plan,
}: {
  readonly accounts: readonly Pick<AccountDto, "openingBalance" | "balance">[];
  readonly page: Pick<TransactionPageDto, "items">;
  readonly spaces: readonly Pick<SpaceDto, "kind">[];
  /** The period's line dashboard (#152). */
  readonly plan?: { readonly plan: LineDashboardDto["plan"]; readonly lines: readonly unknown[] } | undefined;
}): FirstStepsDone => ({
  balances: accounts.some((a) => BigInt(a.openingBalance.amount) !== 0n || moved(a)),
  expense: page.items.length > 0 || accounts.some(moved),
  share: spaces.some((s) => s.kind === "SHARED"),
  plan: plan !== undefined && plan.plan !== null && plan.lines.length > 0,
});

const keyOf = (personId: string) => `hearth.firstSteps.${personId}`;

/** Whether this browser already put the person's first steps away; a blocked storage reads as not yet. */
const wasPutAway = (personId: string): boolean => {
  try {
    return safeStorage()?.getItem(keyOf(personId)) === "1";
  } catch {
    return false;
  }
};

/** Remembers it per person; a full or blocked storage only shows the card again on the next visit. */
const putAway = (personId: string): void => {
  try {
    safeStorage()?.setItem(keyOf(personId), "1");
  } catch {
    // Nothing to do: hiding it on this visit is what the person asked for.
  }
};

/**
 * Issue #220 (F14): a new person's first home proposes four next steps: set what the accounts hold today, record the
 * first expense, share with the household, and set up the month's plan (#152). Each shows as done once it is done; the
 * card goes away once all four are, or when the person dismisses it, and this browser remembers that per person.
 */
export function FirstSteps({
  spaceId,
  personId,
  done,
}: {
  readonly spaceId: string;
  readonly personId: string;
  readonly done: FirstStepsDone;
}) {
  const t = useTranslations("home.firstSteps");
  const titleId = useId();
  const [away, setAway] = useState(() => wasPutAway(personId));
  const complete = done.balances && done.expense && done.share && done.plan;
  useEffect(() => {
    if (complete) putAway(personId);
  }, [complete, personId]);
  if (away || complete) return null;
  const home = `/spaces/${spaceId}`;
  const steps = [
    { key: "balances", href: withReturnTo(`${home}/accounts`, home) },
    { key: "expense", href: withReturnTo(`${home}/new`, home) },
    { key: "share", href: withReturnTo(`/spaces/new?from=${spaceId}`, home) },
    // A Plan tab view needs no way back; Rubros is where a period's plan is started.
    { key: "plan", href: `${home}/plan/lines` },
  ] as const;
  return (
    <section aria-labelledby={titleId} className="flex flex-col rounded-2xl bg-surface px-3 pt-1 pb-2">
      <div className="flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-lg font-semibold text-ink">
          {t("title")}
        </h2>
        <button
          type="button"
          aria-label={t("dismiss")}
          onClick={() => {
            putAway(personId);
            setAway(true);
          }}
          className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted"
        >
          <Icon name="close" size={20} />
        </button>
      </div>
      <ol className="flex flex-col">
        {steps.map(({ key, href }) => (
          <li key={key}>
            {done[key] ? (
              <p className="flex min-h-11 items-center gap-3 text-sm text-muted">
                <span
                  aria-hidden="true"
                  className="flex size-6 shrink-0 items-center justify-center text-accent"
                >
                  <Icon name="check" size={20} />
                </span>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(`step.${key}`)}</span>
                <span className="shrink-0 text-xs font-medium">{t("done")}</span>
              </p>
            ) : (
              <Link href={href} className="flex min-h-11 items-center gap-3 text-sm font-medium text-ink">
                <span aria-hidden="true" className="size-6 shrink-0 rounded-full border-2 border-line" />
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{t(`step.${key}`)}</span>
                <span aria-hidden="true" className="shrink-0 text-muted">
                  <Icon name="chevronRight" size={18} />
                </span>
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

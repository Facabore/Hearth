import Link from "next/link";
import { useTranslations } from "next-intl";
import { useId } from "react";
import type { MoneyDto } from "@/shared/ui/api/dto";

/** Ruling P277: a shared space where it is the person's turn to put money in, and to whom she pays first. */
export interface Owe {
  readonly spaceId: string;
  /** The space's name. */
  readonly space: string;
  /** The person's member id there: Saldos' `?settle=` opens its settle sheet with her paying. */
  readonly memberId: string;
  /** What she puts in, positive. */
  readonly amount: MoneyDto;
  /** Whom she pays first (the settle-up suggestion), when that member is still in the space. */
  readonly to?: string | undefined;
}

/**
 * Board B1 · 03: "Te toca poner $ 120.000 · En Hogar · Saldar", with the initial of whom she pays. Never a debt: the
 * household's own words (U1), and the amount always carries them, never color alone.
 */
export function OweCard({ owe, amount }: { readonly owe: Owe; readonly amount: string }) {
  const t = useTranslations("home.owe");
  const space = useTranslations("shell.space");
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex items-center gap-3 rounded-2xl bg-owe-soft p-3">
      {owe.to ? (
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface font-semibold text-owe-ink"
        >
          {owe.to.trim().charAt(0).toUpperCase()}
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={id} className="font-semibold [overflow-wrap:anywhere] text-ink">
          {space("owes")} <span className="whitespace-nowrap text-owe-ink">{amount}</span>
          {owe.to ? <span className="sr-only"> {t("to", { name: owe.to })}</span> : null}
        </span>
        <span className="text-sm [overflow-wrap:anywhere] text-muted">{t("in", { space: owe.space })}</span>
      </span>
      <Link
        href={`/spaces/${owe.spaceId}/balances?settle=${encodeURIComponent(owe.memberId)}`}
        aria-label={owe.to ? t("settleWith", { name: owe.to, space: owe.space }) : undefined}
        className="flex min-h-11 shrink-0 items-center rounded-full bg-owe px-5 text-sm font-semibold text-on-accent"
      >
        {t("settle")}
      </Link>
    </section>
  );
}

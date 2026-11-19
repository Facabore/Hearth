import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { AmountText } from "@/shared/ui/atoms/amount";
import { formatApproximateMoney } from "@/shared/ui/format/approximate";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { friendTotals, type FriendDto, type FriendsApproximateDto } from "./friends";

const joined = (amounts: readonly MoneyDto[], formats: Formats): string =>
  amounts.map((money) => formatMoney(money, formats)).join(" + ");

/**
 * Ruling P342 (S6): one side's "≈" total, then each amount with no rate today, which it does not hold. A zero total
 * is left out ("≈ 0 COP" never shows), so a side holding only unrated amounts lists just them, and an empty side is "".
 */
const approximately = (side: FriendsApproximateDto["owedToYou"], formats: Formats): string =>
  [
    ...(BigInt(side.total.amount) === 0n ? [] : [formatApproximateMoney(side.total, formats)]),
    ...side.unrated.map((money) => formatMoney(money, formats)),
  ].join(" + ");

/**
 * Ruling P338 (board "Inicio · Personal: Amigos en la barra"): the personal Inicio's line to Amigos, with what the
 * people owe the person and what she owes them, in words. Nothing is drawn while everyone is al día.
 */
export function FriendsLine({
  friends,
  href,
  formats,
  approximate,
}: {
  readonly friends: readonly FriendDto[];
  /** Amigos, the personal space's Saldos tab. */
  readonly href: string;
  readonly formats: Formats;
  /** Ruling P342 (S6): the API's "≈" totals, sent when the debts are in more than one currency. */
  readonly approximate?: FriendsApproximateDto | undefined;
}) {
  const t = useTranslations("home.friends");
  const { owed, owe } = friendTotals(friends);
  if (owed.length === 0 && owe.length === 0) return null;
  const owedText = approximate ? approximately(approximate.owedToYou, formats) : joined(owed, formats);
  const oweText = approximate ? approximately(approximate.youOwe, formats) : joined(owe, formats);
  if (owedText === "" && oweText === "") return null;
  const text =
    owedText !== "" && oweText !== ""
      ? t("both", { owed: owedText, owe: oweText })
      : owedText !== ""
        ? t("owed", { amount: owedText })
        : t("owes", { amount: oweText });
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-2 rounded-2xl bg-surface px-3 py-2 text-base text-ink"
    >
      <span className="min-w-0 flex-1 tabular-nums">
        <AmountText text={text} />
      </span>
      {/* The board's chevron, as text: Inicio's chunk carries no icon set (ADR 0004). */}
      <span aria-hidden="true" className="shrink-0 text-lg text-muted">
        ›
      </span>
    </Link>
  );
}

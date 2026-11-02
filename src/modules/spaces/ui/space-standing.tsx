import { useTranslations } from "next-intl";
import type { ComponentType } from "react";
import type { paths } from "@/shared/ui/api/schema";
import { BUILT_IN_FORMATS, formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { MASKED_AMOUNT, useAmountsHidden } from "./hidden-amounts";

/** The person's standing in one shared or direct space (`GET /api/v1/me/balances`, ruling P278). */
export type MyBalanceDto =
  paths["/api/v1/me/balances"]["get"]["responses"][200]["content"]["application/json"]["items"][number];

export interface SpaceStandingProps {
  /** The space's name, the card's title. */
  readonly name: string;
  readonly balance: MyBalanceDto;
  readonly personId: string;
  readonly formats?: Pick<Formats, "numberFormat"> | undefined;
}

/** The component that draws a shared space's card text; the app loads it with Inicio's chunk (ruling P278). */
export type SpaceStandingView = ComponentType<SpaceStandingProps>;

/** The amount as the person sees it: masked while she hides her amounts (Inicio's eye). */
export const shownAmount = (
  money: { readonly amount: string; readonly currency: string },
  hidden: boolean,
  formats: Pick<Formats, "numberFormat">,
): string => (hidden ? MASKED_AMOUNT : formatMoney(money, formats));

/** "Ana, Juan, Sofi y Pedro": a space's members by name, the last joined with the language's "y". */
const useMemberNames = () => {
  const t = useTranslations("shell.space");
  return (names: readonly string[]): string =>
    names.length < 2
      ? (names[0] ?? "")
      : t("members", { others: names.slice(0, -1).join(", "), last: names.at(-1) ?? "" });
};

/**
 * A shared space's card text in the switcher (board B1 · 04): its name over its members, and on the right what the
 * person puts in or receives there, always in words (never by color alone); nothing when she is al día. It loads
 * with Inicio's chunk, so the shell stays as light as it was.
 */
export function SpaceStanding({ name, balance, personId, formats = BUILT_IN_FORMATS }: SpaceStandingProps) {
  const t = useTranslations("shell.space");
  const names = useMemberNames();
  const hidden = useAmountsHidden(personId);
  const net = BigInt(balance.net.amount);
  return (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold [overflow-wrap:anywhere] text-ink">{name}</span>
        <span className="text-sm [overflow-wrap:anywhere] text-muted">
          {names(balance.members.map((member) => member.name))}
        </span>
      </span>
      {net === 0n ? null : (
        <span
          className={`flex shrink-0 flex-col items-end text-right text-sm font-semibold ${net < 0n ? "text-owe-ink" : "text-accent"}`}
        >
          <span>{t(net < 0n ? "owes" : "owed")}</span>
          <span className="whitespace-nowrap">
            {shownAmount(
              { amount: (net < 0n ? -net : net).toString(), currency: balance.net.currency },
              hidden,
              formats,
            )}
          </span>
        </span>
      )}
    </>
  );
}

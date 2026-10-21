import Link from "next/link";
import { useTranslations } from "next-intl";
import { memberLabel } from "@/modules/spaces/ui";
import { Avatar } from "@/shared/ui";
import type { BalancesDto, MemberDto, SpaceDto, SuggestionDto } from "@/shared/ui/api/dto";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { absolute, memberSentence, netState } from "./net-state";

/**
 * HU-E9-07, the Balances artboard as `/spaces/{spaceId}/balances` (the Saldos tab, ruling P173): the viewer's own
 * net, the API's settle-up suggestions and every current member's net. Only the header speaks to the viewer; the
 * suggestions and the members always use names, so the story's sentences read the same from every seat. Each member
 * row links to a history page that is rarely opened, so the links do not prefetch it (one request per member).
 */
export function BalancesScreen({
  space,
  members,
  meUserId,
  balances,
  suggestions,
  formats,
}: {
  readonly space: SpaceDto;
  readonly members: readonly MemberDto[];
  readonly meUserId: string;
  readonly balances: BalancesDto["members"];
  readonly suggestions: readonly SuggestionDto[];
  readonly formats: Formats;
}) {
  const t = useTranslations("balances");
  const tMembers = useTranslations("members");
  const names = new Map(members.map((member) => [member.id, member.displayName]));
  const netOf = (memberId: string) =>
    balances.find((balance) => balance.memberId === memberId)?.net ?? {
      amount: "0",
      currency: space.currency,
    };
  const viewer = members.find((member) => member.userId === meUserId);
  const mine = viewer ? netOf(viewer.id) : netOf("");
  const state = netState(mine);

  return (
    <div className="flex flex-col gap-5 pb-4">
      <h1 className="sr-only">{t("title")}</h1>
      <section aria-label={t("yours", { space: space.name })} className="flex flex-col gap-1.5 pt-1">
        <span className="text-[15px] text-muted">{t("yours", { space: space.name })}</span>
        <span
          className={`text-4xl font-semibold tabular-nums ${state === "owes" ? "text-owe" : state === "owed" ? "text-accent" : "text-ink"}`}
        >
          {t(`you.${state}`, { amount: formatMoney(absolute(mine), formats) })}
        </span>
      </section>
      <section aria-labelledby="balances-suggestions" className="flex flex-col gap-2">
        <h2 id="balances-suggestions" className="text-[17px] font-semibold text-ink">
          {t("suggestions")}
        </h2>
        {suggestions.length === 0 ? (
          <p className="rounded-2xl bg-track p-3 text-sm text-ink">
            {t("allSettled", { space: space.name })}
          </p>
        ) : (
          <>
            <ol className="flex flex-col gap-2">
              {suggestions.map((suggestion) => {
                const payer = names.get(suggestion.payerMemberId) ?? "";
                return (
                  <li
                    key={`${suggestion.payerMemberId}-${suggestion.receivingMemberId}`}
                    className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3"
                  >
                    <Avatar name={payer} />
                    <span className="min-w-0 flex-1 text-base tabular-nums">
                      {t("owes", {
                        payer,
                        receiver: names.get(suggestion.receivingMemberId) ?? "",
                        amount: formatMoney(suggestion.amount, formats),
                      })}
                    </span>
                  </li>
                );
              })}
            </ol>
            <p className="text-[13px] text-muted">{t("suggestionsNote")}</p>
          </>
        )}
      </section>
      <section aria-labelledby="balances-members" className="flex flex-col gap-1.5">
        <h2 id="balances-members" className="text-[17px] font-semibold text-ink">
          {t("members")}
        </h2>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {members.map((member) => {
            const net = netOf(member.id);
            const memberState = netState(net);
            const sentence = memberSentence(net, formats, t);
            const name = memberLabel(member, meUserId, tMembers);
            return (
              <li key={member.id}>
                <Link
                  href={`/spaces/${space.id}/members/${member.id}/history`}
                  aria-label={t("member.link", { name, sentence })}
                  prefetch={false}
                  className="flex min-h-[60px] items-center gap-3 px-3.5 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">{name}</span>
                  <span
                    className={`text-[15px] font-semibold tabular-nums ${memberState === "owes" ? "text-owe" : memberState === "owed" ? "text-accent" : "text-muted"}`}
                  >
                    {sentence}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { FriendsLine } from "@/modules/balances/ui";
import { NeedsToday } from "@/modules/ledger/ui";
import { controlsFor, type MyBalanceDto } from "@/modules/spaces/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { useApis } from "../api";
import {
  myPendingOccurrencesQuery,
  pendingOccurrencesQuery,
  type OccurrenceDto,
} from "../recurring-pending/queries";
import { myBalancesQuery, myFriendsApproximateQuery, myFriendsQuery } from "../shell";

/** Ruling P342 (S4): a balance's nets, one per currency and never converted; an older API's `net` alone otherwise. */
const netsOf = (b: MyBalanceDto): readonly MyBalanceDto["net"][] =>
  b.nets ?? (BigInt(b.net.amount) === 0n ? [] : [b.net]);

/**
 * Board B1 · 03 (ruling P278): each space where it is the person's turn to put money in, and whom she pays first:
 * every shared one on the personal home, this one on a shared home. Ruling P342: in any currency, the space's first;
 * one line per space, in the first currency she owes in (the line opens that space's Saldos, where each one shows).
 */
const owesOf = (balances: readonly MyBalanceDto[], spaces: readonly SpaceDto[], space: SpaceDto) =>
  balances
    .filter((b) => space.kind === "PERSONAL" || b.spaceId === space.id)
    .flatMap((b) => {
      const named = spaces.find((s) => s.id === b.spaceId);
      const owed = netsOf(b).find((net) => BigInt(net.amount) < 0n);
      if (!named || !owed) return [];
      const first = b.payments.find((p) => p.amount.currency === owed.currency) ?? b.payments[0];
      return [
        {
          spaceId: b.spaceId,
          space: named.name,
          memberId: b.memberId,
          amount: { amount: (-BigInt(owed.amount)).toString(), currency: owed.currency },
          to: b.members.find((m) => m.memberId === first?.receivingMemberId)?.name,
        },
      ];
    });

/**
 * #288: each space where the others owe the person: every one on the personal home, this one on a shared home. Ruling
 * P342: one figure per currency owed to her, never converted.
 */
const owedOf = (balances: readonly MyBalanceDto[], spaces: readonly SpaceDto[], space: SpaceDto) =>
  balances
    .filter((b) => space.kind === "PERSONAL" || b.spaceId === space.id)
    .flatMap((b) => {
      const named = spaces.find((s) => s.id === b.spaceId);
      // The API names no debtor; in a space of two, it can only be the other member.
      const others = b.members.filter((m) => m.memberId !== b.memberId);
      const from = others.length === 1 ? others[0]!.name : undefined;
      return named
        ? netsOf(b)
            .filter((net) => BigInt(net.amount) > 0n)
            .map((amount) => ({ spaceId: b.spaceId, space: named.name, amount, from }))
        : [];
    });

/**
 * #288 (board "Propuesta · Inicio personal · te necesita hoy", approved 2026-11-09): Inicio's "Te necesita hoy" from the
 * query cache. It reads the person's balances (ruling P278) and the bills that wait for their real amount in every space
 * where she records money on the personal home, all of them in one read (#338), and in this one on a shared home: the
 * same read as the bar's badge, so it costs nothing. Inicio loads it in a chunk of its own, so the route keeps its script budget.
 * Ruling P338: the personal Inicio's line to Amigos comes first, read here on its own so Inicio never waits for it.
 */
export function NeedsTodayHost({
  space,
  spaces,
  today,
  formats,
}: {
  readonly space: SpaceDto;
  readonly spaces: readonly SpaceDto[];
  readonly today: string;
  readonly formats: Formats;
}) {
  const { api } = useApis();
  const personal = space.kind === "PERSONAL";
  const shared = spaces.some((s) => s.kind !== "PERSONAL");
  const balances = useQuery({ ...myBalancesQuery(api), enabled: shared }).data ?? [];
  const withFriends = personal && spaces.some((s) => s.kind === "DIRECT");
  const friends =
    useQuery({
      ...myFriendsQuery(api),
      enabled: withFriends,
      // An optional line: it reads again on each Inicio and never retries.
      refetchOnMount: true,
      retry: false,
    }).data ?? [];
  // Ruling P342 (S6): the "≈" totals come from that same read.
  const approximate = useQuery({
    ...myFriendsApproximateQuery(api),
    enabled: withFriends,
    retry: false,
  }).data;
  const asked = spaces.filter(
    (s) => (personal || s.id === space.id) && controlsFor(s.role, s.kind).recordMoney,
  );
  // #338: the personal home reads every space's bills in one request, so it costs the same with any number of
  // friends; a shared home reads its own space's, the read the bar's badge already made. Neither ever fails Inicio.
  const mine = useQuery({ ...myPendingOccurrencesQuery(api), enabled: personal && asked.length > 0 }).data;
  const here = useQuery({
    ...pendingOccurrencesQuery(api, space.id),
    enabled: !personal && asked.length > 0,
  }).data;
  const itemsOf = (spaceId: string): readonly OccurrenceDto[] =>
    (personal ? mine?.filter((occurrence) => occurrence.spaceId === spaceId) : here) ?? [];
  const pending = asked.flatMap((s) => {
    const items = itemsOf(s.id);
    const [first] = items;
    return first
      ? [
          {
            spaceId: s.id,
            space: s.name,
            count: items.length,
            name: first.description,
            date: first.date,
            amount: first.amount,
          },
        ]
      : [];
  });
  return (
    <>
      {personal ? (
        <FriendsLine
          friends={friends}
          approximate={approximate ?? undefined}
          href={`/spaces/${space.id}/balances`}
          formats={formats}
        />
      ) : null}
      <NeedsToday
        pending={pending}
        owed={owedOf(balances, spaces, space)}
        owes={owesOf(balances, spaces, space)}
        today={today}
        formats={formats}
        here={!personal}
      />
    </>
  );
}

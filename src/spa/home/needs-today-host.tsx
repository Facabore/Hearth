import { useQueries, useQuery } from "@tanstack/react-query";
import { NeedsToday } from "@/modules/ledger/ui";
import { controlsFor, type MyBalanceDto } from "@/modules/spaces/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";
import type { Formats } from "@/shared/ui/format/formatters";
import { useApis } from "../api";
import { pendingOccurrencesQuery } from "../recurring-pending/queries";
import { myBalancesQuery } from "../shell";

/**
 * Board B1 · 03 (ruling P278): each space where it is the person's turn to put money in, and whom she pays first:
 * every shared one on the personal home, this one on a shared home.
 */
const owesOf = (balances: readonly MyBalanceDto[], spaces: readonly SpaceDto[], space: SpaceDto) =>
  balances
    .filter((b) => BigInt(b.net.amount) < 0n && (space.kind === "PERSONAL" || b.spaceId === space.id))
    .flatMap((b) => {
      const named = spaces.find((s) => s.id === b.spaceId);
      if (!named) return [];
      const first = b.payments[0];
      return [
        {
          spaceId: b.spaceId,
          space: named.name,
          memberId: b.memberId,
          amount: { amount: (-BigInt(b.net.amount)).toString(), currency: b.net.currency },
          to: b.members.find((m) => m.memberId === first?.receivingMemberId)?.name,
        },
      ];
    });

/** #288: each space where the others owe the person: every one on the personal home, this one on a shared home. */
const owedOf = (balances: readonly MyBalanceDto[], spaces: readonly SpaceDto[], space: SpaceDto) =>
  balances
    .filter((b) => BigInt(b.net.amount) > 0n && (space.kind === "PERSONAL" || b.spaceId === space.id))
    .flatMap((b) => {
      const named = spaces.find((s) => s.id === b.spaceId);
      // The API names no debtor; in a space of two, it can only be the other member.
      const others = b.members.filter((m) => m.memberId !== b.memberId);
      const from = others.length === 1 ? others[0]!.name : undefined;
      return named ? [{ spaceId: b.spaceId, space: named.name, amount: b.net, from }] : [];
    });

/**
 * #288 (board "Propuesta · Inicio personal · te necesita hoy", approved 2026-11-09): Inicio's "Te necesita hoy" from the
 * query cache. It reads the person's balances (ruling P278) and the bills that wait for their real amount in every space
 * where she records money on the personal home, in this one on a shared home: the same reads as the bar's badge, so a
 * space already read costs nothing. Inicio loads it in a chunk of its own, so the route keeps its script budget.
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
  const asked = spaces.filter(
    (s) => (personal || s.id === space.id) && controlsFor(s.role, s.kind).recordMoney,
  );
  const reads = useQueries({ queries: asked.map((s) => pendingOccurrencesQuery(api, s.id)) });
  const pending = asked.flatMap((s, i) => {
    const items = reads[i]?.data ?? [];
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
    <NeedsToday
      pending={pending}
      owed={owedOf(balances, spaces, space)}
      owes={owesOf(balances, spaces, space)}
      today={today}
      formats={formats}
      here={!personal}
    />
  );
}

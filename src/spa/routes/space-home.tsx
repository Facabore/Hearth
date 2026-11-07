import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import {
  firstStepsOf,
  HomeSummary,
  UnifiedRecent,
  mergedFeed,
  TransactionSheetHost,
  UnifiedSummary,
  unifiedMonthOf,
} from "@/modules/ledger/ui";
import { SpaceStanding, type MyBalanceDto } from "@/modules/spaces/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { useHome, useTransactionDetail, useViewer } from "../ledger/hooks";
import { showsUnifiedMonth } from "../load";
import { FEED_ROWS } from "../ledger/queries";
import { lineReportQuery, myActivityQuery, unifiedViewQuery } from "../reads";
import { myBalancesQuery, spaceStandingSlot } from "../shell";
import { useTitle } from "../title";

// Ruling P278: the switcher's cards with the person's standing ride in this chunk, which already holds the formats.
spaceStandingSlot.current = SpaceStanding;

const route = getRouteApi("/spaces/$spaceId/");

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

/**
 * HU-E9-01: the home of a space from the query cache (ADR 0006). `?joined=1` (U6) welcomes a person who has just
 * accepted an invitation; `?tx=<id>` opens a recent row's detail sheet over it (ruling P189).
 */
export function SpaceHome() {
  useTitle(useTranslations("home")("title"));
  const { spaceId } = route.useParams();
  const { joined, tx } = route.useSearch();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const { page, accounts, context } = useHome(viewer);
  const detail = useTransactionDetail(viewer, tx);
  const { space } = viewer;
  const home = `/spaces/${spaceId}`;
  const today = nowIn(new Date(), viewer.me.timezone).date;
  // U4 (#209): the personal home of someone with other spaces also says what her month costs across all of them, and
  // opens Mi consumo for that period, a stacked screen (U10, ruling P267).
  const unified = showsUnifiedMonth(viewer);
  const allSpaces = useQuery({
    ...unifiedViewQuery(api, spaceId, page.period.label),
    enabled: unified,
  }).data;
  // Ruling P306: Recientes merges her shared and direct spaces' latest movements from the period's start.
  const activity = useQuery({
    ...myActivityQuery(api, spaceId, page.period.startDate, FEED_ROWS),
    enabled: unified,
  }).data;
  // #152 (P265): the first steps' plan step reads the period's line dashboard, only where the card can show.
  const personal = space.kind === "PERSONAL";
  const plan = useQuery({
    ...lineReportQuery(api, spaceId, page.period.label),
    enabled: personal && accounts.length > 0,
  }).data;
  // Ruling P278: the card "Te toca poner", for someone with a shared or direct space.
  const shared = viewer.spaces.some((s) => s.kind !== "PERSONAL");
  const balances = useQuery({ ...myBalancesQuery(api), enabled: shared }).data;
  return (
    <>
      <HomeSummary
        spaceId={spaceId}
        kind={space.kind}
        role={space.role}
        joined={joined === "1" ? { space: space.name, dismissHref: home } : undefined}
        policy={space.periodPolicy}
        page={page}
        accounts={accounts}
        context={context}
        today={today}
        // Ruling P306: the personal home of someone with other spaces counts her month in all of them and merges their
        // latest movements into Recientes.
        summary={
          unified && allSpaces ? (
            <UnifiedSummary
              unified={unifiedMonthOf(allSpaces)}
              page={page}
              policy={space.periodPolicy}
              formats={context.formats}
              personId={viewer.me.id}
            />
          ) : undefined
        }
        recent={
          unified && activity ? (
            <UnifiedRecent
              feed={mergedFeed(page.items, activity, FEED_ROWS)}
              spaceId={spaceId}
              context={context}
              today={today}
              personId={viewer.me.id}
            />
          ) : undefined
        }
        // #220 (F14): the personal home proposes a new person's first steps, from what it already read.
        firstSteps={
          personal
            ? { personId: viewer.me.id, done: firstStepsOf({ accounts, page, spaces: viewer.spaces, plan }) }
            : undefined
        }
        personId={viewer.me.id}
        owes={balances ? owesOf(balances, viewer.spaces, space) : undefined}
      />
      {detail ? (
        <TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={home} api={api} />
      ) : null}
    </>
  );
}

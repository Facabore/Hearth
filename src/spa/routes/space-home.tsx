import { useQueries, useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import {
  firstStepsOf,
  HomeSummary,
  UnifiedRecent,
  mergedFeed,
  PeriodStepper,
  TransactionSheetHost,
  UnifiedSummary,
  unifiedMonthOf,
} from "@/modules/ledger/ui";
import { myConsumptionHref, PlanCard } from "@/modules/reporting/ui";
import dynamic from "next/dynamic";
import { SpaceStanding } from "@/modules/spaces/ui";
import type { PeriodDto } from "@/shared/ui/api/dto";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { useHome, useTransactionDetail, useViewer } from "../ledger/hooks";
import { showsUnifiedMonth } from "../load";
import { FEED_ROWS, homeQueryOf, neighboursOf } from "../ledger/queries";
import { lineReportQuery, myActivityQuery, unifiedViewQuery } from "../reads";
import { spaceStandingSlot } from "../shell";
import { useTitle } from "../title";

/** #288: "Te necesita hoy" reads and draws in a chunk of its own (ADR 0004). */
const NeedsTodayHost = dynamic(
  () => import("../home/needs-today-host").then((module) => module.NeedsTodayHost),
  {
    ssr: false,
  },
);

// Ruling P278: the switcher's cards with the person's standing ride in this chunk, which already holds the formats.
spaceStandingSlot.current = SpaceStanding;

const route = getRouteApi("/spaces/$spaceId/");

/**
 * HU-E9-01: the home of a space from the query cache (ADR 0006). `?joined=1` (U6) welcomes a person who has just
 * accepted an invitation; `?tx=<id>` opens a recent row's detail sheet over it (ruling P189).
 */
export function SpaceHome() {
  useTitle(useTranslations("home")("title"));
  const { spaceId } = route.useParams();
  const { joined, tx, period } = route.useSearch();
  const { api } = useApis();
  const viewer = useViewer(spaceId);
  const { page, accounts, context } = useHome(viewer, period);
  const detail = useTransactionDetail(viewer, tx);
  const { space } = viewer;
  const home = `/spaces/${spaceId}`;
  const today = nowIn(new Date(), viewer.me.timezone).date;
  const personal = space.kind === "PERSONAL";
  // Ruling P310: the personal Inicio steps between periods; the current one is the plain address, as the API answers it.
  const holdsToday = (p: Pick<PeriodDto, "startDate" | "endDate">) =>
    p.startDate <= today && today <= p.endDate;
  // Without a period asked for, the API answers today's, so the plain address is never another one.
  const current = homeQueryOf(viewer, period).period === undefined || holdsToday(page.period);
  // Only a period that ended before today hides today's balances; one after today's keeps them.
  const past = personal && !current && page.period.endDate < today;
  const periodHref = (p: PeriodDto) =>
    holdsToday(p) ? home : `${home}?period=${encodeURIComponent(p.label)}`;
  const [previous, next] = useQueries({
    queries: neighboursOf(api, spaceId, page.period).map((query) => ({ ...query, enabled: personal })),
  });
  // U4 (#209): the personal home of someone with other spaces also says what her month costs across all of them, and
  // opens Mi consumo for that period, a stacked screen (U10, ruling P267).
  const unified = showsUnifiedMonth(viewer);
  const allSpaces = useQuery({
    ...unifiedViewQuery(api, spaceId, page.period.label),
    enabled: unified,
  }).data;
  // Ruling P306: Recientes merges her shared and direct spaces' latest movements from the period's start.
  const activity = useQuery({
    ...myActivityQuery(api, spaceId, page.period.startDate, FEED_ROWS, page.period.endDate),
    enabled: unified,
  }).data;
  // #152 (P265): the first steps' plan step reads the period's line dashboard; ruling P311: so does the line "Tu plan de
  // {mes}", in any period, and ruling P324: a shared space's hero, "de $ X del plan". The loader reads it ahead, so it
  // draws in the first paint.
  const planned = personal || space.kind === "SHARED";
  const plan = useQuery({ ...lineReportQuery(api, spaceId, page.period.label), enabled: planned }).data;
  const planHref = `${home}/plan${holdsToday(page.period) ? "" : `?period=${encodeURIComponent(page.period.label)}`}`;
  return (
    <>
      <HomeSummary
        spaceId={spaceId}
        kind={space.kind}
        name={space.name}
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
              consumptionHref={myConsumptionHref(space, page.period.label)}
            />
          ) : undefined
        }
        plan={
          planned && plan ? (
            <PlanCard
              dashboard={plan}
              policy={space.periodPolicy}
              formats={context.formats}
              href={planHref}
              variant={personal ? "line" : "hero"}
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
            />
          ) : undefined
        }
        // #220 (F14): the personal home proposes a new person's first steps, from what it already read.
        firstSteps={
          personal
            ? { personId: viewer.me.id, done: firstStepsOf({ accounts, page, spaces: viewer.spaces, plan }) }
            : undefined
        }
        needs={
          <NeedsTodayHost space={space} spaces={viewer.spaces} today={today} formats={context.formats} />
        }
        past={past}
        stepper={
          personal ? (
            <PeriodStepper
              period={page.period}
              policy={space.periodPolicy}
              formats={context.formats}
              previousHref={previous?.data ? periodHref(previous.data) : undefined}
              nextHref={!current && next?.data ? periodHref(next.data) : undefined}
            />
          ) : undefined
        }
      />
      {detail ? (
        <TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={home} api={api} />
      ) : null}
    </>
  );
}

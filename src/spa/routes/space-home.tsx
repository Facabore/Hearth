import { useQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { firstStepsOf, HomeSummary, TransactionSheetHost } from "@/modules/ledger/ui";
import { myConsumptionHref } from "@/modules/reporting/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { useHome, useTransactionDetail, useViewer } from "../ledger/hooks";
import { showsUnifiedMonth } from "../load";
import { lineReportQuery, unifiedViewQuery } from "../reads";
import { useTitle } from "../title";

const route = getRouteApi("/spaces/$spaceId/");

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
  // U4 (#209): the personal home of someone with other spaces also says what her month costs across all of them, and
  // opens Mi consumo for that period, a stacked screen (U10, ruling P267).
  const unified = showsUnifiedMonth(viewer);
  const allSpaces = useQuery({
    ...unifiedViewQuery(api, spaceId, page.period.label),
    enabled: unified,
  }).data;
  // #152 (P265): the first steps' plan step reads the period's line dashboard, only where the card can show.
  const personal = space.kind === "PERSONAL";
  const plan = useQuery({
    ...lineReportQuery(api, spaceId, page.period.label),
    enabled: personal && accounts.length > 0,
  }).data;
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
        today={nowIn(new Date(), viewer.me.timezone).date}
        allSpaces={
          unified && allSpaces
            ? { total: allSpaces.consumption.total, href: myConsumptionHref(space, page.period.label) }
            : undefined
        }
        // #220 (F14): the personal home proposes a new person's first steps, from what it already read.
        firstSteps={
          personal
            ? { personId: viewer.me.id, done: firstStepsOf({ accounts, page, spaces: viewer.spaces, plan }) }
            : undefined
        }
      />
      {detail ? (
        <TransactionSheetHost spaceId={spaceId} detail={detail} context={context} origin={home} api={api} />
      ) : null}
    </>
  );
}

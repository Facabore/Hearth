import { useSuspenseQueries } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { canManage } from "@/modules/budgeting/ui";
import {
  CapacityForm,
  isEditable,
  LineEditor,
  memberOf,
  ownSuggestion,
  Planner,
} from "@/modules/budgeting/ui/screens";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { NotFoundScreen, ScreenHeader } from "@/shared/ui";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { accountsQuery, capacitySuggestionQuery, categoriesQuery, membersQuery, planQuery } from "../reads";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const planner = getRouteApi("/spaces/$spaceId/plans/$planId");
const capacities = getRouteApi("/spaces/$spaceId/plans/$planId/capacities");
const newLine = getRouteApi("/spaces/$spaceId/plans/$planId/lines/new");
const editLine = getRouteApi("/spaces/$spaceId/plans/$planId/lines/$lineId");

/** HU-E9-08: the planner of one plan, in the person's formats and today's date in their zone. */
export function PlannerRoute() {
  useTitle(useTranslations("budgeting.planner")("metaTitle"));
  const { spaceId, planId } = planner.useParams();
  const { api } = useApis();
  const { me, space } = useViewer(spaceId);
  const [plan, list, groups] = useSuspenseQueries({
    queries: [
      planQuery(api, spaceId, planId),
      membersQuery(api, spaceId),
      categoriesQuery(api, spaceId, "all"),
    ],
  });
  // The planner keeps the plan it last saved in its own state: a new plan, or a newer version of this one read after a
  // write, must start it afresh, as each page visit did under Next.js.
  return (
    <Planner
      key={`${plan.data.id}:${plan.data.version}`}
      space={space}
      plan={plan.data}
      members={list.data}
      groups={groups.data}
      formats={me.preferences.effective}
      today={nowIn(new Date(), me.timezone).date}
    />
  );
}

/**
 * HU-E9-08: the capacities of one plan. Only the viewer's own suggestion goes on to the form, so another member's is
 * never shown (ruling P208).
 */
export function CapacitiesRoute() {
  useTitle(useTranslations("budgeting.capacity")("title"));
  const { spaceId, planId } = capacities.useParams();
  const { api } = useApis();
  const { me, space } = useViewer(spaceId);
  const [plan, list, suggestion] = useSuspenseQueries({
    queries: [
      planQuery(api, spaceId, planId),
      membersQuery(api, spaceId),
      capacitySuggestionQuery(api, spaceId, planId),
    ],
  });
  return (
    <CapacityForm
      key={planId}
      space={space}
      plan={plan.data}
      members={list.data}
      viewerUserId={me.id}
      suggestion={ownSuggestion(suggestion.data, memberOf(list.data, me.id))}
      formats={me.preferences.effective}
    />
  );
}

/**
 * HU-E9-08: the editor of one line, or a new one; whoever may not edit the plan gets a read-only note. The savings
 * accounts offered are the caller's own active SAVINGS accounts in the plan's currency (ruling P213).
 */
function LineEditorScreen({
  spaceId,
  planId,
  lineId,
}: {
  readonly spaceId: string;
  readonly planId: string;
  readonly lineId: string | null;
}) {
  const t = useTranslations("budgeting.lineEditor");
  const { api } = useApis();
  const { me, space, spaces } = useViewer(spaceId);
  const [plan, accounts, groups, list] = useSuspenseQueries({
    queries: [
      planQuery(api, spaceId, planId),
      accountsQuery(api, personalSpaceOf(spaces).id, "active"),
      categoriesQuery(api, spaceId, "active"),
      membersQuery(api, spaceId),
    ],
  });
  const line = lineId === null ? null : plan.data.lines.find((one) => one.id === lineId);
  useTitle(line === null ? t("newTitle") : t("metaTitle"));
  // Not one of the plan's lines (removed, or another plan's): not found, as the Next.js container answers.
  if (line === undefined) return <NotFoundScreen />;
  if (!canManage(space.role) || !isEditable(plan.data)) {
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
        <ScreenHeader
          backHref={`/spaces/${spaceId}/plans/${planId}`}
          title={line === null ? t("newTitle") : t("title", { name: line.name })}
        />
        <p className="text-base text-muted">{t("readOnly")}</p>
      </div>
    );
  }
  return (
    <LineEditor
      key={`${planId}:${lineId ?? "new"}`}
      space={space}
      plan={plan.data}
      line={line}
      savingsAccounts={accounts.data.filter(
        (account) =>
          account.type === "SAVINGS" &&
          account.archivedAt === null &&
          account.balance.currency === plan.data.totalCapacity.currency,
      )}
      groups={groups.data}
      members={list.data}
      formats={me.preferences.effective}
    />
  );
}

export function NewLineRoute() {
  const { spaceId, planId } = newLine.useParams();
  return <LineEditorScreen spaceId={spaceId} planId={planId} lineId={null} />;
}

export function EditLineRoute() {
  const { spaceId, planId, lineId } = editLine.useParams();
  return <LineEditorScreen spaceId={spaceId} planId={planId} lineId={lineId} />;
}

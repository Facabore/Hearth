import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CategoryGroupDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { serverNow } from "@/shared/ui/time/server-now";
import { nowIn } from "@/shared/ui/time/when";
import { Planner } from "./planner";

/**
 * HU-E9-08: the plan, the space's current members (names for capacities and allocations) and its categories with the
 * archived ones, so the copy notice can still name a category that was archived since (ruling P209).
 */
export const loadPlanner = async (
  api: Api,
  { spaceId, planId }: { spaceId: string; planId: string },
): Promise<Loaded<{ plan: BudgetPlanDto; members: SpaceMemberDto[]; groups: CategoryGroupDto[] }>> => {
  const [plan, members, categories] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", { params: { path: { spaceId, planId } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId } } })),
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/categories", {
        params: { path: { spaceId }, query: { archived: "true" } },
      }),
    ),
  ]);
  if (!plan.ok) return plan;
  if (!members.ok) return members;
  if (!categories.ok) return categories;
  return {
    ok: true,
    data: { plan: plan.data, members: members.data.items, groups: categories.data.items },
  };
};

/** Server: the planner of `planId`, in the person's formats and today's date in their zone. */
export async function PlannerContainer({
  spaceId,
  planId,
}: {
  readonly spaceId: string;
  readonly planId: string;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  const result = await loadPlanner(await serverApi(), { spaceId, planId });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <Planner
      space={space}
      plan={result.data.plan}
      members={result.data.members}
      groups={result.data.groups}
      formats={me!.preferences.effective}
      today={nowIn(serverNow(), me!.timezone).date}
    />
  );
}

import { notFound } from "next/navigation";
import { ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CapacitySuggestionDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { memberOf } from "../plan-access";
import { ownSuggestion } from "./capacity-draft";
import { CapacityForm } from "./capacity-form";

/**
 * HU-E9-08: the plan, the space's current members and the caller's suggestion. The suggestion is the caller's own
 * (the endpoint takes no member), read here on the server with the request's cookie (ruling P208). A suggestion that
 * cannot be read never blocks the screen: it is `null`.
 */
export const loadCapacities = async (
  api: Api,
  { spaceId, planId }: { spaceId: string; planId: string },
): Promise<
  Loaded<{ plan: BudgetPlanDto; members: SpaceMemberDto[]; suggestion: CapacitySuggestionDto | null }>
> => {
  const [plan, members, suggestion] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", { params: { path: { spaceId, planId } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/members", { params: { path: { spaceId } } })),
    loaded(
      api.GET("/api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion", {
        params: { path: { spaceId, planId } },
      }),
    ),
  ]);
  if (!plan.ok) return plan;
  if (!members.ok) return members;
  return {
    ok: true,
    data: {
      plan: plan.data,
      members: members.data.items,
      suggestion: suggestion.ok ? suggestion.data : null,
    },
  };
};

/**
 * Server: the capacities of `planId`. Only the viewer's own suggestion goes on to the client component, so another
 * member's never travels in the page (ruling P208, review focus 2).
 */
export async function CapacityContainer({
  spaceId,
  planId,
}: {
  readonly spaceId: string;
  readonly planId: string;
}) {
  // The reads wait for the space check, never for the person (issue #196).
  const spaceRead = getSpaces().then((spaces) => spaces.find((s) => s.id === spaceId) ?? notFound());
  const read = Promise.all([serverApi(), spaceRead]).then(([api]) =>
    loadCapacities(api, { spaceId, planId }),
  );
  void read.catch(() => undefined);
  const [me, space] = await Promise.all([getMe(), spaceRead]);
  const result = await read;
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  return (
    <CapacityForm
      space={space}
      plan={result.data.plan}
      members={result.data.members}
      viewerUserId={me!.id}
      suggestion={ownSuggestion(result.data.suggestion, memberOf(result.data.members, me!.id))}
      formats={me!.preferences.effective}
    />
  );
}

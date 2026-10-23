import { getTranslations } from "next-intl/server";
import { PlannerContainer } from "@/modules/budgeting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.planner"))("metaTitle") };
}

/** HU-E9-08: the planner of one plan, reached from the Plan tab (ruling P200). */
export default async function PlannerPage({
  params,
}: {
  readonly params: Promise<{ spaceId: string; planId: string }>;
}) {
  const { spaceId, planId } = await params;
  return <PlannerContainer spaceId={spaceId} planId={planId} />;
}

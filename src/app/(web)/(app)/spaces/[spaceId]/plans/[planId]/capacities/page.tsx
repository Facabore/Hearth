import { getTranslations } from "next-intl/server";
import { CapacityContainer } from "@/modules/budgeting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("budgeting.capacity"))("title") };
}

/** HU-E9-08: the capacities of one plan, with the viewer's private suggestion, reached from the planner. */
export default async function CapacitiesPage({
  params,
}: {
  readonly params: Promise<{ spaceId: string; planId: string }>;
}) {
  const { spaceId, planId } = await params;
  return <CapacityContainer spaceId={spaceId} planId={planId} />;
}

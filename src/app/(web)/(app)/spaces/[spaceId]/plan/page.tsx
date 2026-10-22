import { getTranslations } from "next-intl/server";
import { LineDashboardContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("title") };
}

/** HU-E9-10: the Plan tab of a space, `?period=<label>` (ruling P200). */
export default async function PlanPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <LineDashboardContainer spaceId={spaceId} period={period} />;
}

import { getTranslations } from "next-intl/server";
import { PlanHomeContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("title") };
}

/** HU-E9-10, HU-E9-11: the Plan tab of a space, `?period=<label>`; My spending in the personal space (ruling P200). */
export default async function PlanPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <PlanHomeContainer spaceId={spaceId} period={period} />;
}

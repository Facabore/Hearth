import { getTranslations } from "next-intl/server";
import { LineDashboardContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("lines") };
}

/** HU-E9-11: the Lines view of a space's Plan tab, the personal space's second view, `?period=<label>` (ruling P200). */
export default async function LinesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <LineDashboardContainer spaceId={spaceId} period={period} />;
}

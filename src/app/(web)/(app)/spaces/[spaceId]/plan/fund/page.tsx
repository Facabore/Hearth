import { getTranslations } from "next-intl/server";
import { FundTrackingContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("fund") };
}

/** HU-E9-10: the Fund view of a shared space's Plan tab, `?period=<label>` (ruling P200). */
export default async function FundPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <FundTrackingContainer spaceId={spaceId} period={period} />;
}

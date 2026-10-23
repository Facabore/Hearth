import { getTranslations } from "next-intl/server";
import { TrendHomeContainer, windowOf } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("trend") };
}

/** HU-E9-11: the Trend view of the Plan tab, the caller's own consumption in the personal space, `?period=<label>&periods=6|12` (P200, P219). */
export default async function TrendPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string; periods?: string }>;
}) {
  const [{ spaceId }, { period, periods }] = await Promise.all([params, searchParams]);
  return <TrendHomeContainer spaceId={spaceId} period={period} periods={windowOf(periods)} />;
}

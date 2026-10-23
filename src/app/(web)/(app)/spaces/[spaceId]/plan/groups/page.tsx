import { getTranslations } from "next-intl/server";
import { SpendingByGroupContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("groups") };
}

/** HU-E9-10: the By group view of a shared space's Plan tab, `?period=<label>`, drilling with `?drill=` (P200, P215). */
export default async function GroupsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <SpendingByGroupContainer spaceId={spaceId} period={period} />;
}

import { getTranslations } from "next-intl/server";
import { GroupsHomeContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports.view"))("groups") };
}

/** HU-E9-10, HU-E9-11: the By group view of the Plan tab, the caller's own in the personal space, `?period=<label>`, drilling with `?drill=` (P200, P215). */
export default async function GroupsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <GroupsHomeContainer spaceId={spaceId} period={period} />;
}

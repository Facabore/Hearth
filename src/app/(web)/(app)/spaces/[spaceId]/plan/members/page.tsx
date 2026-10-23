import { getTranslations } from "next-intl/server";
import { MemberMatrixContainer } from "@/modules/reporting/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("reports"))("view.members") };
}

/** HU-E9-10: the member matrix of the Plan tab, `?period=<label>` (ruling P200). */
export default async function MembersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ period?: string }>;
}) {
  const [{ spaceId }, { period }] = await Promise.all([params, searchParams]);
  return <MemberMatrixContainer spaceId={spaceId} period={period} />;
}

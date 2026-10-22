import { getTranslations } from "next-intl/server";
import { MembersContainer } from "@/modules/spaces/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("members"))("title") };
}

/** HU-E9-05: the members of a shared or direct space, with the controls the viewer's role allows. */
export default async function MembersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ invite?: string }>;
}) {
  const [{ spaceId }, { invite }] = await Promise.all([params, searchParams]);
  return (
    <div className="mx-auto max-w-[720px] py-4">
      <MembersContainer spaceId={spaceId} openInvite={invite === "1"} />
    </div>
  );
}

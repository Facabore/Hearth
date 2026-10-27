import { getTranslations } from "next-intl/server";
import { MembersContainer } from "@/modules/spaces/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("members"))("title") };
}

/** HU-E9-05: the members of a shared or direct space, with the controls the viewer's role allows. */
export default routeScreen<{ spaceId: string }, { invite?: string }>(async ({ spaceId }, { invite }) => (
  <div className="mx-auto max-w-[720px] py-3">
    {await MembersContainer({ spaceId, openInvite: invite === "1" })}
  </div>
));

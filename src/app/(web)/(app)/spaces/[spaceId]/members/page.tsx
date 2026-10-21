import { getTranslations } from "next-intl/server";
import { MembersContainer } from "@/modules/spaces/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("members"))("title") };
}

/** HU-E9-05: the members of a shared or direct space, with the controls the viewer's role allows. */
export default async function MembersPage({ params }: { readonly params: Promise<{ spaceId: string }> }) {
  return (
    <div className="mx-auto max-w-[720px] py-4">
      <MembersContainer spaceId={(await params).spaceId} />
    </div>
  );
}

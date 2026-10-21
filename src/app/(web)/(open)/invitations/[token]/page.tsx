import { getTranslations } from "next-intl/server";
import { InvitationContainer } from "@/modules/spaces/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("invitation"))("pageTitle") };
}

/** HU-E9-05, ruling P157: open to anyone holding the token, signed in or not. */
export default async function InvitationPage({ params }: { readonly params: Promise<{ token: string }> }) {
  return <InvitationContainer kind="invitation" token={(await params).token} />;
}

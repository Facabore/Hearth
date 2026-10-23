import { getTranslations } from "next-intl/server";
import { InvitationContainer } from "@/modules/spaces/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("invitation"))("claim.pageTitle") };
}

/** HU-E9-05, ruling P157: open to anyone holding the claim token, signed in or not. */
export default async function ClaimPage({ params }: { readonly params: Promise<{ token: string }> }) {
  return <InvitationContainer kind="claim" token={(await params).token} />;
}

import { HomeContainer } from "@/modules/ledger/ui/server";

/** HU-E9-01: the Home of a space. */
export default async function SpaceHomePage({ params }: { readonly params: Promise<{ spaceId: string }> }) {
  return <HomeContainer spaceId={(await params).spaceId} />;
}

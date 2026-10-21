import { getTranslations } from "next-intl/server";
import { BalancesContainer } from "@/modules/balances/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("balances"))("title") };
}

/** HU-E9-07: who owes whom in a shared or direct space, and the settle-up suggestions. */
export default async function BalancesPage({ params }: { readonly params: Promise<{ spaceId: string }> }) {
  return (
    <div className="mx-auto max-w-[720px] py-4">
      <BalancesContainer spaceId={(await params).spaceId} />
    </div>
  );
}

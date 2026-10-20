import { getTranslations } from "next-intl/server";
import { AccountsContainer } from "@/modules/accounts/ui";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("title") };
}

/** HU-E9-03: the accounts of a space. */
export default async function AccountsPage({ params }: { readonly params: Promise<{ spaceId: string }> }) {
  return <AccountsContainer spaceId={(await params).spaceId} />;
}

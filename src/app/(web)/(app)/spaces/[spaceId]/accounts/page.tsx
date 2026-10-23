import { getTranslations } from "next-intl/server";
import { AccountsContainer } from "@/modules/accounts/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("title") };
}

/** HU-E9-03: the accounts of a space. */
export default async function AccountsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ spaceId }, { returnTo }] = await Promise.all([params, searchParams]);
  return <AccountsContainer spaceId={spaceId} returnTo={returnTo} />;
}

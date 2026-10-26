import { getTranslations } from "next-intl/server";
import { EditAccountContainer } from "@/modules/accounts/ui/server";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts.edit"))("title") };
}

/** Issue 169: edit an account's name, opening balance, icon, attributes and switches. */
export default async function EditAccountPage({
  params,
}: {
  readonly params: Promise<{ spaceId: string; accountId: string }>;
}) {
  const { spaceId, accountId } = await params;
  return <EditAccountContainer spaceId={spaceId} accountId={accountId} />;
}

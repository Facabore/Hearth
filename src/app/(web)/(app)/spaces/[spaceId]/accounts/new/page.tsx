import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewAccountForm } from "@/modules/accounts/ui";
import { getMe, getSpaces } from "@/shared/ui/api/server";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("newTitle") };
}

/** HU-E9-03: create an account in the space, in the person's number format. */
export default async function NewAccountPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ returnTo?: string }>;
}) {
  const [{ spaceId }, { returnTo }] = await Promise.all([params, searchParams]);
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  return <NewAccountForm space={space} formats={me!.preferences.effective} returnTo={returnTo} />;
}

import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { NewAccountForm } from "@/modules/accounts/ui";
import { getMe, getSpaces } from "@/shared/ui/api/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

export async function generateMetadata() {
  return { title: (await getTranslations("accounts"))("newTitle") };
}

/** HU-E9-03: create an account in the space, in the person's number format. */
export default routeScreen<{ spaceId: string }, { returnTo?: string }>(async ({ spaceId }, { returnTo }) => {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  return <NewAccountForm space={space} formats={me!.preferences.effective} returnTo={returnTo} />;
});

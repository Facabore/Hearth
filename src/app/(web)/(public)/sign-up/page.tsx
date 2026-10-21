import { getTranslations } from "next-intl/server";
import { SignUpClosedNotice, SignUpFormContainer } from "@/modules/identity/ui";
import { getSignUpMode } from "@/shared/ui/api/server";
import { invitationOf } from "@/shared/ui/navigation/invitation";

export async function generateMetadata() {
  return { title: (await getTranslations("auth.signUp"))("title") };
}

/**
 * Rulings P143 and P147: while sign-up is closed, a visitor without `?invitation=` reads the notice and gets no form.
 * A signed-in person never gets here: the public layout redirects them (P145).
 */
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ invitation?: string | string[] }>;
}) {
  const [{ invitation }, mode] = await Promise.all([searchParams, getSignUpMode()]);
  const token = invitationOf(invitation);
  if (mode === "closed" && token === undefined) return <SignUpClosedNotice />;
  return <SignUpFormContainer invitation={token} />;
}

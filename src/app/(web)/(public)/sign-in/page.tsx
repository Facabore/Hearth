import { getTranslations } from "next-intl/server";
import { SignInFormContainer } from "@/modules/identity/ui";
import { getSignUpMode } from "@/shared/ui/api/server";
import { safeNext } from "@/shared/ui/navigation/auth-redirect";

export async function generateMetadata() {
  return { title: (await getTranslations("auth.signIn"))("title") };
}

/** Rulings P143 (the sign-up link follows the mode, read here) and P151 (`expired=1` says the session ended). */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; expired?: string }>;
}) {
  const [{ next, expired }, signUp] = await Promise.all([searchParams, getSignUpMode()]);
  return <SignInFormContainer next={safeNext(next)} expired={expired === "1"} signUp={signUp} />;
}

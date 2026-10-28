import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { SignInFormContainer } from "@/modules/identity/ui";
import { safeNext } from "@/shared/ui/navigation/auth-redirect";
import { invitationOf } from "@/shared/ui/navigation/invitation";
import { useApis } from "../api";
import { signUpModeQuery } from "../queries";
import { useTitle } from "../title";

const route = getRouteApi("/public/sign-in");

/** Rulings P143 (the sign-up link follows the mode), P147 (it keeps `?invitation=`) and P151 (`expired=1`). */
export function SignInScreen() {
  const { next, expired, invitation } = route.useSearch();
  const { api, sessionApi } = useApis();
  const signUp = useSuspenseQuery(signUpModeQuery(sessionApi)).data;
  useTitle(useTranslations("auth.signIn")("title"));
  return (
    <SignInFormContainer
      next={safeNext(next)}
      expired={expired === "1"}
      signUp={signUp}
      invitation={invitationOf(invitation)}
      api={api}
    />
  );
}

import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { SignUpClosedNotice, SignUpFormContainer, signInHrefOf } from "@/modules/identity/ui";
import { safeNext } from "@/shared/ui/navigation/auth-redirect";
import { invitationOf } from "@/shared/ui/navigation/invitation";
import { useApis } from "../api";
import { signUpModeQuery } from "../queries";
import { useTitle } from "../title";

const route = getRouteApi("/public/sign-up");

/** Rulings P143 and P147: while sign-up is closed, a visitor without `?invitation=` reads the notice and gets no form. */
export function SignUpScreen() {
  const { next, invitation } = route.useSearch();
  const { api, sessionApi } = useApis();
  const mode = useSuspenseQuery(signUpModeQuery(sessionApi)).data;
  useTitle(useTranslations("auth.signUp")("title"));
  const token = invitationOf(invitation);
  const target = safeNext(next);
  if (mode === "closed" && token === undefined)
    return <SignUpClosedNotice signInHref={signInHrefOf(target, undefined)} />;
  return <SignUpFormContainer next={target} invitation={token} api={api} />;
}

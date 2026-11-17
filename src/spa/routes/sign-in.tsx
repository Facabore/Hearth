import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { SignInFormContainer } from "@/modules/identity/ui";
import { safeNext } from "@/shared/ui/navigation/auth-redirect";
import { invitationOf } from "@/shared/ui/navigation/invitation";
import { useApis } from "../api";
import { signUpModeQuery } from "../queries";
import { forgetReferral } from "../referrals/link";
import { friendLinkNext } from "../spaces/friend-link";
import { useTitle } from "../title";

const route = getRouteApi("/public/sign-in");

/**
 * Rulings P143 (the sign-up link follows the mode), P147 (it keeps `?invitation=`) and P151 (`expired=1`). D27: a
 * referral link the device kept is forgotten on sign-in, so it never credits the next account made on this device.
 * Ruling P339 (S6): without a `next`, a friend link the device kept is where the person goes once signed in.
 */
export function SignInScreen() {
  const { next, expired, invitation } = route.useSearch();
  const { api, sessionApi } = useApis();
  const signUp = useSuspenseQuery(signUpModeQuery(sessionApi)).data;
  useTitle(useTranslations("auth.signIn")("title"));
  const [link] = useState(friendLinkNext);
  return (
    <SignInFormContainer
      next={next === undefined && link !== undefined ? link : safeNext(next)}
      expired={expired === "1"}
      signUp={signUp}
      invitation={invitationOf(invitation)}
      api={api}
      onSignedIn={forgetReferral}
    />
  );
}

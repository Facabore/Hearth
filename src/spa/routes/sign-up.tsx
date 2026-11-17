import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslations } from "use-intl";
import { SignUpClosedNotice, SignUpFormContainer, signInHrefOf } from "@/modules/identity/ui";
import { safeNext } from "@/shared/ui/navigation/auth-redirect";
import { invitationOf } from "@/shared/ui/navigation/invitation";
import { useApis } from "../api";
import { signUpModeQuery } from "../queries";
import { claimReferral, referralPreviewQuery, rememberedReferral } from "../referrals/link";
import { friendLinkNext } from "../spaces/friend-link";
import { useTitle } from "../title";

const route = getRouteApi("/public/sign-up");

/**
 * D27: the referral link this device remembers, if any. The form names its owner once the public read answers, and
 * the new account claims it before moving on; an unknown code names nobody and claims nothing visible.
 */
const useReferral = () => {
  const { sessionApi } = useApis();
  const [code] = useState(rememberedReferral);
  const invitedBy = useQuery({
    ...referralPreviewQuery(sessionApi, code ?? ""),
    enabled: code !== undefined,
  }).data;
  return {
    ...(invitedBy ? { invitedBy } : {}),
    ...(code === undefined ? {} : { afterSignUp: () => claimReferral(sessionApi, code) }),
  };
};

/**
 * Rulings P143 and P147: while sign-up is closed, a visitor without `?invitation=` reads the notice and gets no form.
 * Ruling P339 (S6): without a `next`, a friend link the device kept is where the new account goes.
 */
export function SignUpScreen() {
  const { next, invitation } = route.useSearch();
  const { api, sessionApi } = useApis();
  const mode = useSuspenseQuery(signUpModeQuery(sessionApi)).data;
  useTitle(useTranslations("auth.signUp")("title"));
  const referral = useReferral();
  const token = invitationOf(invitation);
  const [link] = useState(friendLinkNext);
  const target = next === undefined && link !== undefined ? link : safeNext(next);
  if (mode === "closed" && token === undefined)
    return <SignUpClosedNotice signInHref={signInHrefOf(target, undefined)} />;
  return <SignUpFormContainer next={target} invitation={token} api={api} {...referral} />;
}

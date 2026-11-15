import { queryOptions } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";

/**
 * D27: the referral link a visitor opened (`/r/<code>`), kept on this device until the account it brings exists: it
 * is forgotten after its one claim, or when someone signs in instead. The storage may be missing or refuse (a private
 * window, blocked site data): the link then simply credits nobody.
 */
const KEY = "hearth.referral";
/** What a code can look like on the wire; anything else is never stored, and the API decides whether it is one. */
const SHAPE = /^[A-Za-z0-9-]{1,64}$/;

export const rememberReferral = (code: string): void => {
  if (!SHAPE.test(code)) return;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // Nothing kept: the sign-up goes on without a referrer.
  }
};

export const rememberedReferral = (): string | undefined => {
  try {
    const code = localStorage.getItem(KEY);
    return code !== null && SHAPE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
};

export const forgetReferral = (): void => {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to forget.
  }
};

export const referralKeys = {
  mine: ["referrals", "mine"] as const,
  preview: (code: string) => ["referrals", "preview", code] as const,
};

/**
 * D27: the first name of the link's owner, or null when the API names nobody (an unknown code is a 404) or cannot be
 * reached: the sign-up form then shows no chip, and says nothing about the link.
 */
export const referralPreviewQuery = (api: Api, code: string) =>
  queryOptions<string | null>({
    queryKey: referralKeys.preview(code),
    queryFn: async () => {
      try {
        const { data } = await api.GET("/api/v1/referrals/{code}", { params: { path: { code } } });
        return data?.firstName ?? null;
      } catch {
        return null;
      }
    },
    staleTime: Infinity,
    retry: false,
  });

/**
 * D27: after the sign-up, the new account names the link it came through; the sign-up does not wait for it. Whatever
 * the API answers (the account is too old, the code is its own or unknown, it has a referrer already), the SPA says
 * nothing; the link is forgotten once it was tried.
 */
export const claimReferral = async (api: Api, code: string): Promise<void> => {
  try {
    await api.POST("/api/v1/me/referrer", { body: { code } });
  } finally {
    forgetReferral();
  }
};

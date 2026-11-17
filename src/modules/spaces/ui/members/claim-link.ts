import type { Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";

/** A guest's single-use claim link (P163): its URL comes back once, only its hash is stored. */
export interface ClaimLink {
  readonly url: string;
  readonly expiresAt: string;
}

/**
 * Ruling P163: creates a claim link for a guest, so the person it names takes their place with its history. The guest
 * sheet and Amigos' "Invitar" (P338) both ask for it here.
 */
export const createClaimLink = async (
  api: Api,
  spaceId: string,
  memberId: string,
): Promise<{ readonly claim: ClaimLink } | { readonly problem: Problem }> => {
  try {
    const { data, error, response } = await api.POST(
      "/api/v1/spaces/{spaceId}/guests/{memberId}/claim-links",
      { params: { path: { spaceId, memberId } } },
    );
    return response.ok && data
      ? { claim: { url: data.url, expiresAt: data.invitation.expiresAt } }
      : { problem: problemFrom(error, response) };
  } catch (error) {
    return { problem: problemFrom(error, undefined) };
  }
};

import type { QueryClient } from "@tanstack/react-query";
import type { MeDto, SpaceDto } from "@/shared/ui/api/dto";
import { queryKeys } from "../queries";
import { moduleKeys } from "../reads";
import type { WritePlanner } from "../write-plan";

const SPACE = "/api/v1/spaces/{spaceId}";
/** HU-E9-05's writes on a space's people: guests, claim links, invitations and roles. */
const MEMBERS = new Set([
  `POST ${SPACE}/guests`,
  `DELETE ${SPACE}/guests/{memberId}`,
  `POST ${SPACE}/guests/{memberId}/claim-links`,
  `POST ${SPACE}/invitations`,
  `POST ${SPACE}/invitations/{invitationId}/revoke`,
  `PATCH ${SPACE}/members/{memberId}`,
]);
const ACCEPTS = new Set(["/api/v1/invitations/{token}/accept", "/api/v1/claims/{token}/accept"]);

/** A space someone just joined or created: it joins the person's spaces before the screen lands in it. */
const joined = (queryClient: QueryClient, space: SpaceDto) => {
  queryClient.setQueryData<SpaceDto[]>(queryKeys.spaces, (spaces = []) =>
    spaces.some((one) => one.id === space.id) ? spaces : [...spaces, space],
  );
  void queryClient.invalidateQueries({ queryKey: queryKeys.spaces });
};

/**
 * The person's profile, their spaces and a space's people in the SPA (HU-E9-05, HU-E9-13, #167).
 * - A new space, or one joined from an invitation or a claim (P157), joins the list before the screen lands in it,
 *   so the shell finds it at once; the list is read again.
 * - A renamed space shows its new name everywhere the list does.
 * - Signing out leaves the cache to the sign-in screen's guard, which drops the person's answers.
 * - A preference changes every format on every screen, and the profile's answer is the whole profile: it replaces the
 *   cached one, so every screen formats again without reading anything.
 */
export const spaceWrites: WritePlanner = (call) => {
  if (call.method === "POST" && (call.path === "/api/v1/spaces" || ACCEPTS.has(call.path)))
    return { accepted: (queryClient, data) => joined(queryClient, data as SpaceDto) };
  // The members (pending invitations under them) and every balance, which a guest's removal or a role may change.
  if (MEMBERS.has(`${call.method} ${call.path}`)) {
    const { spaceId = "" } = call.params;
    return {
      accepted: (queryClient) => {
        void queryClient.invalidateQueries({ queryKey: moduleKeys.members(spaceId) });
        void queryClient.invalidateQueries({ queryKey: moduleKeys.balances(spaceId) });
      },
    };
  }
  if (call.method === "PATCH" && call.path === "/api/v1/spaces/{spaceId}")
    return {
      accepted: (queryClient, data) => {
        const renamed = data as SpaceDto;
        queryClient.setQueryData<SpaceDto[]>(queryKeys.spaces, (spaces = []) =>
          spaces.map((space) => (space.id === renamed.id ? renamed : space)),
        );
        void queryClient.invalidateQueries({ queryKey: queryKeys.spaces });
      },
    };
  // Signing out reads nothing again: every read of the person would answer 401. The sign-in screen's guard finds the
  // person gone and drops their answers (guards.ts).
  if (call.method === "POST" && call.path === "/api/v1/auth/sign-out") return { accepted: () => undefined };
  if (call.method === "PATCH" && call.path === "/api/v1/me")
    return {
      accepted: (queryClient, data) => queryClient.setQueryData<MeDto | null>(queryKeys.me, data as MeDto),
    };
  return null;
};

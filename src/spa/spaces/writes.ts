import type { MeDto, SpaceDto } from "@/shared/ui/api/dto";
import { queryKeys } from "../queries";
import type { WritePlanner } from "../write-plan";

/**
 * The person's profile and their spaces' list in the SPA (HU-E9-05, HU-E9-13, #167).
 * - A new space joins the list before the form lands in it, so the shell finds it at once; the list is read again.
 * - A renamed space shows its new name everywhere the list does.
 * - A preference changes every format on every screen, and the profile's answer is the whole profile: it replaces the
 *   cached one, so every screen formats again without reading anything.
 */
export const spaceWrites: WritePlanner = (call) => {
  if (call.method === "POST" && call.path === "/api/v1/spaces")
    return {
      accepted: (queryClient, data) => {
        queryClient.setQueryData<SpaceDto[]>(queryKeys.spaces, (spaces = []) => [
          ...spaces,
          data as SpaceDto,
        ]);
        void queryClient.invalidateQueries({ queryKey: queryKeys.spaces });
      },
    };
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
  if (call.method === "PATCH" && call.path === "/api/v1/me")
    return {
      accepted: (queryClient, data) => queryClient.setQueryData<MeDto | null>(queryKeys.me, data as MeDto),
    };
  return null;
};

import { queryOptions } from "@tanstack/react-query";
import type { FriendRequestsDto } from "@/modules/balances/ui";
import type { Api } from "@/shared/ui/api/client";
import { read } from "../read";

/** Ruling P339: the friend requests the person received and sent, beside her Amigos. */
export const friendRequestsKey = ["balances", "mine", "friend-requests"] as const;

/**
 * Ruling P339 (S4): the requests the person received, newest first, and the ones she sent that were not accepted.
 * Amigos' loader reads it on each visit (ADR 0006) and an answer changes it; it never retries, and Amigos without it
 * shows no requests.
 */
export const friendRequestsQuery = (api: Api) =>
  queryOptions<FriendRequestsDto>({
    refetchOnMount: false,
    retry: false,
    queryKey: friendRequestsKey,
    queryFn: () => read(api.GET("/api/v1/me/friend-requests")),
  });

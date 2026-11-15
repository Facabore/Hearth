import { queryOptions } from "@tanstack/react-query";
import type { MyReferralsDto } from "@/modules/referrals/ui";
import type { Api } from "@/shared/ui/api/client";
import { read } from "../read";
import { referralKeys } from "./link";

/**
 * D27: the person's link, points and referrals; the code is created on the first read. Loader-owned like the screens'
 * reads (`LOADER_OWNED` in reads.ts, which Más would otherwise load whole for one flag).
 */
export const myReferralsQuery = (api: Api) =>
  queryOptions<MyReferralsDto>({
    refetchOnMount: false,
    queryKey: referralKeys.mine,
    queryFn: () => read(api.GET("/api/v1/me/referrals")),
  });

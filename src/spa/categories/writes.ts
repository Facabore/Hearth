import { moduleKeys } from "../reads";
import type { WritePlanner } from "../write-plan";

const SPACE = "/api/v1/spaces/{spaceId}";
const CATEGORIES = new RegExp(`^${SPACE.replace(/[{}$]/g, "\\$&")}/(categories|category-groups)(/|$)`);

/**
 * HU-E9-04's writes: a category or a group created, edited, moved, archived, restored or deleted. The tree shows the
 * API's answer at once by itself; the cache reads the space's categories again (every picker and row name reads them)
 * and the plan's reports, which group by them. The ledger keeps its rows: they name categories from that same read.
 */
export const categoryWrites: WritePlanner = (call) => {
  if (!CATEGORIES.test(call.path)) return null;
  const { spaceId = "" } = call.params;
  return {
    accepted: (queryClient) => {
      void queryClient.invalidateQueries({ queryKey: moduleKeys.categoryLists(spaceId) });
      void queryClient.invalidateQueries({ queryKey: moduleKeys.reports(spaceId) });
    },
  };
};

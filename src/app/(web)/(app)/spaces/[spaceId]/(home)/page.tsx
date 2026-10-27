import { HomeContainer } from "@/modules/ledger/ui/server";
import { routeScreen } from "@/shared/ui/api/route-screen";

/**
 * HU-E9-01: the Home of a space. `?joined=1` (U6) welcomes a person who has just accepted an invitation, and
 * `?tx=<id>` opens a recent transaction's detail sheet (ruling P189).
 */
export default routeScreen<{ spaceId: string }, { joined?: string; tx?: string }>(
  ({ spaceId }, { joined, tx }) => HomeContainer({ spaceId, joined: joined === "1", transactionId: tx }),
);

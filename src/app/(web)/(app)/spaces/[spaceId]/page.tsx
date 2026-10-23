import { HomeContainer } from "@/modules/ledger/ui/server";

/**
 * HU-E9-01: the Home of a space. `?joined=1` (U6) welcomes a person who has just accepted an invitation, and
 * `?tx=<id>` opens a recent transaction's detail sheet (ruling P189).
 */
export default async function SpaceHomePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ spaceId: string }>;
  readonly searchParams: Promise<{ joined?: string; tx?: string }>;
}) {
  const [{ spaceId }, { joined, tx }] = await Promise.all([params, searchParams]);
  return <HomeContainer spaceId={spaceId} joined={joined === "1"} transactionId={tx} />;
}

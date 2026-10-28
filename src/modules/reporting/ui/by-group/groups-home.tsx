import { getSpaces } from "@/shared/ui/api/server";
import { spaceOf } from "../report-period";
import { SpendingByGroupContainer } from "./by-group-container";
import { PersonalSpendingByGroupContainer } from "./personal-by-group-container";

/** Ruling P200: the By group view is the caller's own report in the personal space and the space's in a shared one. */
export async function GroupsHomeContainer({
  spaceId,
  period,
}: {
  readonly spaceId: string;
  readonly period?: string;
}) {
  const space = spaceOf(await getSpaces(), spaceId);
  // Issue #196: called, not rendered as an element, so its reads and checks run inside the route's screen.
  return space.kind === "PERSONAL"
    ? PersonalSpendingByGroupContainer({ spaceId, period })
    : SpendingByGroupContainer({ spaceId, period });
}

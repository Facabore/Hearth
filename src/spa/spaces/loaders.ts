import { notFound } from "@tanstack/react-router";
import { controlsFor, personalSpaceOf } from "@/modules/spaces/ui";
import { addDays, type LocalDate } from "@/shared/kernel/local-date";
import { ensurer, viewerOf, type Load, type Viewer } from "../load";
import {
  accountsQuery,
  balanceHistoryQuery,
  invitationsQuery,
  membersQuery,
  netBalancesQuery,
  periodQuery,
  suggestionsQuery,
} from "../reads";

/** Names only: a read that fails leaves its part out, never the screen. */
const settled = (read: Promise<unknown>): Promise<void> =>
  read.then(
    () => undefined,
    () => undefined,
  );

/** A shared or direct space; a personal one has no members, balances or history (ruling P159), so it is not found. */
const sharedOnly = async (load: Load, spaceId: string): Promise<Viewer> => {
  const viewer = await viewerOf(load, spaceId);
  if (!viewer || viewer.space.kind === "PERSONAL") throw notFound();
  return viewer;
};

/**
 * HU-E9-05: the members in join order, every net balance (the guest sheet reads it, P163) and, only for someone who
 * may invite, the pending invitations (P155).
 */
export const loadMembers = async (load: Load, spaceId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const { space } = await sharedOnly(load, spaceId);
  await Promise.all([
    ensure(membersQuery(api, spaceId)),
    ensure(netBalancesQuery(api, spaceId)),
    controlsFor(space.role, space.kind).invite ? ensure(invitationsQuery(api, spaceId)) : undefined,
  ]);
};

/**
 * HU-E9-07: the members, every net balance and the settle-up suggestions; for someone who records money, the accounts
 * a payment may leave from (P174), which never fail the screen.
 */
export const loadBalances = async (load: Load, spaceId: string) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  const { space, spaces } = await sharedOnly(load, spaceId);
  await Promise.all([
    ensure(membersQuery(api, spaceId)),
    ensure(netBalancesQuery(api, spaceId)),
    ensure(suggestionsQuery(api, spaceId)),
    controlsFor(space.role, space.kind).recordMoney
      ? settled(
          Promise.all([
            ensure(accountsQuery(api, spaceId, "active")),
            ensure(accountsQuery(api, personalSpaceOf(spaces).id, "active")),
          ]),
        )
      : undefined,
  ]);
};

/**
 * Ruling P176: the period holding `?from=` (the current one without it), the members, the member's movements within
 * it and the neighbouring periods (P130), a neighbour that fails just absent.
 */
export const loadHistory = async (
  load: Load,
  spaceId: string,
  memberId: string,
  from: string | undefined,
) => {
  const ensure = ensurer(load);
  const { api } = load.apis;
  await sharedOnly(load, spaceId);
  const [period] = await Promise.all([
    ensure(periodQuery(api, spaceId, from)),
    ensure(membersQuery(api, spaceId)),
  ]);
  if (!period) throw new Error("The API answered no period");
  await Promise.all([
    ensure(balanceHistoryQuery(api, spaceId, memberId, period)),
    settled(ensure(periodQuery(api, spaceId, addDays(period.startDate as LocalDate, -1)))),
    settled(ensure(periodQuery(api, spaceId, addDays(period.endDate as LocalDate, 1)))),
  ]);
};

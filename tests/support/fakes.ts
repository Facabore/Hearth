import type { SpaceAccess, SpaceMembership, StoredPeriodSource } from "@/modules/spaces/application";
import {
  domainError,
  err,
  Money,
  ok,
  type Id,
  type IdGenerator,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";

/** Runs work directly: in-memory adapters have nothing to roll back. */
export const memoryTm: TransactionManager = { run: (work) => work() };

/** Deterministic ids: `${prefix}-1`, `${prefix}-2`, … */
export const sequentialIds = (prefix = "id"): IdGenerator => {
  let n = 0;
  return { next: <B extends string>() => `${prefix}-${++n}` as Id<B> };
};

export const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}`);
  return result.value;
};

/** "ok" or the error code, so assertions read `expect(codeOf(result)).toBe("InvalidAmount")`. */
export const codeOf = (result: Result<unknown>): string => (result.ok ? "ok" : result.error.code);

export const money = (minor: bigint, currency = "COP"): Money => unwrap(Money.ofMinor(minor, currency));

type MembershipOverrides = Omit<Partial<SpaceMembership>, "spaceId" | "memberId"> & {
  spaceId?: string;
  memberId?: string;
};

/** Ana as OWNER of her personal space unless overridden. */
export const membership = (overrides: MembershipOverrides = {}): SpaceMembership => {
  const { spaceId = "space-ana", memberId = "member-ana", ...rest } = overrides;
  return {
    name: "Personal",
    spaceKind: "PERSONAL",
    currency: "COP",
    periodPolicy: { kind: "MONTHLY", day: 1 },
    userId: "u-ana",
    role: "OWNER",
    ...rest,
    spaceId: spaceId as SpaceMembership["spaceId"],
    memberId: memberId as SpaceMembership["memberId"],
  };
};

/** SpaceAccess over a fixed list of memberships; anything else is SpaceNotFound. */
export const fakeSpaceAccess =
  (...memberships: SpaceMembership[]): SpaceAccess =>
  async (spaceId, userId) => {
    const found = memberships.find((m) => m.spaceId === spaceId && m.userId === userId);
    return found ? ok(found) : err(domainError("SpaceNotFound"));
  };

export const noStoredPeriods: StoredPeriodSource = async () => [];

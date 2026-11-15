import {
  domainError,
  err,
  ok,
  type Clock,
  type IdGenerator,
  type Result,
  type TransactionManager,
} from "@/shared/kernel";
import { createDirectSpace, pairKeyOf, type DirectCounterpart } from "../domain/direct-space";
import type { SpaceId } from "../domain/space";
import type { SpaceCreatedListener } from "./create-personal-space";
import type { DirectSpaceRepository } from "./direct-space-repository";
import type { SpaceAccess } from "./space-access";
import type { SpaceRepository } from "./space-repository";

/** HU-E1-13: whom to split with: a member of a space the requester is in, or a new guest. */
export type DirectSplitCounterpart =
  | { readonly memberId: string }
  | { readonly guest: { readonly displayName: string; readonly contactEmail?: string } };

export interface SplitWithPersonInput<E> {
  readonly userId: string;
  readonly userName: string;
  /** A new direct space's default categories are seeded in this locale (HU-E3-01). */
  readonly locale: string;
  readonly counterpart: DirectSplitCounterpart;
  /** The expense to record, opaque to spaces; the recorder knows its shape. */
  readonly expense: E;
}

export interface DirectSplit<T> {
  readonly spaceId: SpaceId;
  /** True when this split created the direct space. */
  readonly created: boolean;
  readonly recorded: T;
}

/** Records the split's expense in its direct space; bound to the ledger's RecordExpense by the composition root. */
export type DirectExpenseRecorder<E, T> = (input: {
  readonly spaceId: string;
  readonly userId: string;
  readonly expense: E;
}) => Promise<Result<T>>;

interface DirectSpaceDeps {
  readonly access: SpaceAccess;
  readonly spaces: Pick<SpaceRepository, "listForUser">;
  readonly direct: DirectSpaceRepository;
  readonly onCreated: SpaceCreatedListener;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface SplitWithPersonDeps<E, T> extends DirectSpaceDeps {
  readonly recordExpense: DirectExpenseRecorder<E, T>;
  readonly tm: TransactionManager;
}

export type SplitWithPerson<E, T> = (input: SplitWithPersonInput<E>) => Promise<Result<DirectSplit<T>>>;

type Requester = Pick<SplitWithPersonInput<unknown>, "userId" | "userName" | "locale">;
type Resolved = { readonly spaceId: SpaceId; readonly created: boolean };

const newDirectSpace = async (
  deps: DirectSpaceDeps,
  requester: Requester,
  counterpart: DirectCounterpart,
): Promise<Result<Resolved>> => {
  const personal = (await deps.spaces.listForUser(requester.userId)).find((s) => s.kind === "PERSONAL");
  const space = createDirectSpace({
    id: deps.ids.next<"Space">(),
    // Generated in this order, so the creator sorts first among two members who join at the same instant.
    creatorMemberId: deps.ids.next<"SpaceMember">(),
    counterpartMemberId: deps.ids.next<"SpaceMember">(),
    creatorUserId: requester.userId,
    creatorName: requester.userName,
    counterpart,
    // HU-E1-13: the creator's personal-space currency; every user has one (HU-E1-02), COP by default (spec 3).
    currency: personal?.currency ?? "COP",
    now: deps.clock.now(),
  });
  if (!space.ok) return space;
  const spaceId = await deps.direct.addDirect(space.value);
  // A concurrent first split with the same person created the pair's space meanwhile: record there.
  if (spaceId !== space.value.id) return ok({ spaceId, created: false });
  const seeded = await deps.onCreated(space.value, { locale: requester.locale });
  if (!seeded.ok) return seeded;
  return ok({ spaceId, created: true });
};

/** HU-E1-13, D16: the direct space to record in, reused for the same person and created on first use. */
const directSpaceFor = async (
  deps: DirectSpaceDeps,
  requester: Requester,
  counterpart: DirectSplitCounterpart,
): Promise<Result<Resolved>> => {
  if ("guest" in counterpart) {
    const { displayName, contactEmail } = counterpart.guest;
    return newDirectSpace(deps, requester, {
      kind: "GUEST",
      displayName,
      contactEmail: contactEmail ?? null,
    });
  }
  const found = await deps.direct.findCurrentMember(counterpart.memberId);
  if (found === null) return err(domainError("MemberNotFound"));
  // Only someone the requester shares a space with: other spaces' members do not exist for them (spec 8).
  // A read: someone in an archived space is still someone the requester shares a space with (HU-E1-09).
  const shared = await deps.access(found.spaceId, requester.userId, { readOnly: true });
  if (!shared.ok) return shared.error.code === "SpaceNotFound" ? err(domainError("MemberNotFound")) : shared;
  const { member } = found;
  if (member.userId === requester.userId) return err(domainError("InvalidDirectCounterpart"));
  // Someone picked in an active direct space the requester is in: that space, also after its guest claimed it.
  if (found.spaceKind === "DIRECT" && !shared.value.archived)
    return ok({ spaceId: found.spaceId, created: false });
  // HU-E1-09: an archived direct space takes no new expense, and its guest exists only there (D15).
  if (found.spaceKind === "DIRECT" && member.userId === null) return err(domainError("SpaceArchived"));
  // A guest exists only in its own space (D15): a one-to-one split with them starts from a new guest.
  if (member.userId === null) return err(domainError("InvalidDirectCounterpart"));
  const existing = await deps.direct.findByPairKey(pairKeyOf(requester.userId, member.userId));
  if (existing !== null) return ok({ spaceId: existing, created: false });
  return newDirectSpace(deps, requester, {
    kind: "USER",
    userId: member.userId,
    displayName: member.displayName,
  });
};

/** Resolves the person's direct space and records their expense there (HU-E1-13). */
const recordWith = async <E, T>(
  deps: SplitWithPersonDeps<E, T>,
  requester: Requester,
  counterpart: DirectSplitCounterpart,
  expense: E,
): Promise<Result<DirectSplit<T>>> => {
  const resolved = await directSpaceFor(deps, requester, counterpart);
  if (!resolved.ok) return resolved;
  const { spaceId, created } = resolved.value;
  const recorded = await deps.recordExpense({ spaceId, userId: requester.userId, expense });
  if (!recorded.ok) return recorded;
  return ok({ spaceId, created, recorded: recorded.value });
};

/**
 * HU-E1-13: splits an expense with one person through their two-member DIRECT space, created on the first
 * split and reused after it. Space and expense are recorded in one transaction, so a refused expense
 * leaves no direct space behind.
 */
export const createSplitWithPerson =
  <E, T>(deps: SplitWithPersonDeps<E, T>): SplitWithPerson<E, T> =>
  (input) =>
    deps.tm.run(() => recordWith(deps, input, input.counterpart, input.expense));

/** P331: an expense that was for several people, each person's part with them and the recorder's own part. */
export interface SplitWithPeopleInput<E> extends Requester {
  /** Each other person with their part, as an expense of its own; at least one. */
  readonly people: readonly { readonly counterpart: DirectSplitCounterpart; readonly expense: E }[];
  /** The recorder's own part, recorded in their personal space; null when the expense was not for them. */
  readonly own: E | null;
}

export interface PeopleSplit<T> {
  /** Each person's part, in the order given, with the direct space it was recorded in. */
  readonly people: readonly DirectSplit<T>[];
  /** The recorder's own part in their personal space, or null. */
  readonly own: { readonly spaceId: string; readonly recorded: T } | null;
}

export type SplitWithPeople<E, T> = (input: SplitWithPeopleInput<E>) => Promise<Result<PeopleSplit<T>>>;

/**
 * P331: records each person's part as an expense of the pair's direct space (created on first use, HU-E1-13) and the
 * recorder's own part in their personal space, all in one transaction: a refused part refuses all, and nothing is
 * stored. Each part's recording takes its space's money lock before reading its membership (issue #89). A person
 * named twice is refused (InvalidDirectCounterpart), since their parts would land in one space as two debts.
 */
export const createSplitWithPeople =
  <E, T>(deps: SplitWithPersonDeps<E, T>): SplitWithPeople<E, T> =>
  (input) =>
    deps.tm.run<PeopleSplit<T>>(async () => {
      if (input.people.length === 0) return err(domainError("ParticipantsRequired"));
      const people: DirectSplit<T>[] = [];
      for (const { counterpart, expense } of input.people) {
        const split = await recordWith(deps, input, counterpart, expense);
        if (!split.ok) return split;
        if (people.some((p) => p.spaceId === split.value.spaceId))
          return err(domainError("InvalidDirectCounterpart", { reason: "repeated" }));
        people.push(split.value);
      }
      if (input.own === null) return ok({ people, own: null });
      const personal = (await deps.spaces.listForUser(input.userId)).find((s) => s.kind === "PERSONAL");
      if (personal === undefined) return err(domainError("SpaceNotFound"));
      const own = await deps.recordExpense({
        spaceId: personal.id,
        userId: input.userId,
        expense: input.own,
      });
      if (!own.ok) return own;
      return ok({ people, own: { spaceId: personal.id, recorded: own.value } });
    });

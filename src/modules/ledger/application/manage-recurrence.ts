import { can, type SpaceMembership } from "@/modules/spaces/application";
import {
  domainError,
  err,
  Money,
  ok,
  todayIn,
  type LocalDate,
  type PeriodPolicy,
  type Result,
} from "@/shared/kernel";
import {
  endedRecurrence,
  pausedRecurrence,
  resumedRecurrence,
  revisedRecurrence,
  statusOf,
  touchesPersonalAccount,
  type Recurrence,
  type RecurrenceMode,
  type RecurrenceSplit,
} from "../domain/recurrence";
import { scheduleOf } from "../domain/recurrence-schedule";
import { canModify } from "../domain/transaction";
import { inSpaceCurrency } from "./checks";
import type { RecurrenceDeps } from "./recurrence-ports";
import { checkTemplate } from "./recurrence-template";
import { viewsOf, type RecurrenceView } from "./recurrence-view";

export interface RecurrenceWriteInput {
  readonly spaceId: string;
  readonly userId: string;
  readonly recurrenceId: string;
}

/** HU-E4-11: what an edit may change (ruling P22); the type, payer and accounts stay as defined. */
export interface RecurrenceEdit {
  readonly description?: string;
  readonly amount?: Money;
  readonly categoryId?: string;
  /** Null returns to the default split of each occurrence (ruling P23). */
  readonly split?: RecurrenceSplit | null;
  /** Anchor days as requested: InvalidPeriodPolicy unless valid. */
  readonly schedule?: PeriodPolicy;
  readonly mode?: RecurrenceMode;
  readonly endDate?: LocalDate | null;
}

export type UpdateRecurrence = (
  input: RecurrenceWriteInput & { readonly changes: RecurrenceEdit },
) => Promise<Result<RecurrenceView>>;
export type PauseRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>;
export type ResumeRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>;
export type EndRecurrence = (input: RecurrenceWriteInput) => Promise<Result<RecurrenceView>>;

/** What a write does to the money movements of a recurrence that uses a member's own account (D9, ruling P22). */
type MovementEffect =
  /** Pausing and ending only stop them: whoever `canModify` allows may. */
  | "stops"
  /** Changing the recurrence, or resuming it, changes them or turns them back on: only the account's owner may. */
  | "changes";

/**
 * Every recurrence write starts here, inside its transaction: the membership (an archived space refuses, HU-E1-09),
 * the recurrence under its row lock (read under the lock, preflight N4), then the role (ruling P30): its creator
 * changes it, OWNER and ADMIN change anyone's (canModify, as for transactions, HU-E4-06). Then D9: a recurrence that
 * moves money into or out of a member's own account is changed or resumed by that member only, its creator, who
 * owns the account because defining it checked as much.
 */
const recurrenceForWrite = async (
  deps: Pick<RecurrenceDeps, "access" | "recurrences">,
  input: RecurrenceWriteInput,
  effect: MovementEffect,
): Promise<Result<{ space: SpaceMembership; recurrence: Recurrence }>> => {
  const membership = await deps.access(input.spaceId, input.userId);
  if (!membership.ok) return membership;
  const space = membership.value;
  const recurrence = await deps.recurrences.lockForWrite(space.spaceId, input.recurrenceId);
  if (recurrence === null) return err(domainError("RecurrenceNotFound"));
  if (!canModify(space.role, recurrence.createdBy, input.userId)) return err(domainError("InsufficientRole"));
  const touchesOthersAccount =
    input.userId !== recurrence.createdBy && touchesPersonalAccount(recurrence.template);
  return effect === "changes" && touchesOthersAccount
    ? err(domainError("AccountNotOwned"))
    : ok({ space, recurrence });
};

/**
 * Rulings P21 and P26: its template is checked again as recording would check it, for its creator, who must still be
 * a current member. When `creatorRecords` (resuming turns the recording back on), they must also still hold
 * money.record, as the permission matrix says: every AUTO occurrence is recorded on their behalf. Both refusals say
 * `member: "creator"` in their details, because the requester already passed `canModify`: it is the creator, not the
 * requester, who may not.
 */
const rechecked = async (
  deps: RecurrenceDeps,
  space: SpaceMembership,
  recurrence: Recurrence,
  options: { readonly creatorRecords: boolean },
): Promise<Result<Recurrence>> => {
  const members = await deps.members.listCurrent(space.spaceId);
  const creator = members.find((m) => m.userId === recurrence.createdBy);
  // A recurrence whose creator left records on nobody's behalf.
  if (creator === undefined) return err(domainError("NotASpaceMember", { member: "creator" }));
  if (options.creatorRecords && !can(creator.role, "money.record")) {
    return err(domainError("InsufficientRole", { member: "creator" }));
  }
  const amount = Money.ofMinor(recurrence.amount, recurrence.currency);
  if (!amount.ok) return amount;
  const checked = await checkTemplate(
    deps,
    { spaceId: space.spaceId, creatorUserId: recurrence.createdBy },
    members,
    recurrence.template,
    amount.value,
  );
  return checked.ok ? ok(recurrence) : checked;
};

const saved = async (deps: RecurrenceDeps, recurrence: Recurrence): Promise<Result<RecurrenceView>> => {
  await deps.recurrences.save(recurrence);
  const [view] = await viewsOf(deps.occurrences, recurrence.spaceId, [recurrence]);
  return ok(view!);
};

/**
 * HU-E4-11 UpdateRecurrence: description, amount, category, split, schedule, mode and end date change for every
 * occurrence not recorded yet (ruling P24). D9 (ruling P22): a recurrence that moves money into or out of a member's
 * own account (an expense they pay, a contribution, a transfer, an income) is changed by that member, its creator,
 * only, in every field: the amount, but also how often it records and whether it records unasked. A new category,
 * split or amount is checked again as recording would check it (ruling P21).
 *
 * An ENDED recurrence takes no edit, whatever the edit says (`RecurrenceEnded`, checked before anything else of it is
 * looked at). An edit can also end one: a schedule or end date that leaves no date to record from the first one not
 * considered yet makes it ENDED for good, with no later edit or resume. That is accepted (P24, the Task 2a ruling),
 * as a recurrence is continued by defining a new one.
 *
 * A recurrence whose creator left can be renamed, rescheduled or ended, but not checked again: every occurrence is
 * recorded on its creator's behalf (P21) and P26 pauses one whose creator left, so its category, split and amount
 * stay as they are (`NotASpaceMember`, detail `member: "creator"`). To continue it, define a new one. When it also
 * moves money through that creator's own account, nobody else may change it (D9) and only ending it remains.
 */
export const createUpdateRecurrence =
  (deps: RecurrenceDeps): UpdateRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input, "changes");
      if (!found.ok) return found;
      const { space, recurrence } = found.value;
      // Refused first, so that an ended recurrence never answers about what the edit would have changed.
      if (statusOf(recurrence) === "ENDED") return err(domainError("RecurrenceEnded"));
      const { amount, schedule, ...rest } = input.changes;
      const nextSchedule = schedule === undefined ? ok(undefined) : scheduleOf(schedule);
      if (!nextSchedule.ok) return nextSchedule;
      const revised = revisedRecurrence(
        recurrence,
        { ...rest, amount: amount?.minor, schedule: nextSchedule.value },
        deps.clock.now(),
      );
      if (!revised.ok) return revised;
      if (amount !== undefined) {
        const currency = inSpaceCurrency(space, amount);
        if (!currency.ok) return currency;
      }
      // A new category, split or amount is what recording an occurrence checks (P21).
      if (rest.categoryId !== undefined || rest.split !== undefined || amount !== undefined) {
        const checked = await rechecked(deps, space, revised.value, { creatorRecords: false });
        if (!checked.ok) return checked;
      }
      return saved(deps, revised.value);
    });

/** HU-E4-11 PauseRecurrence: nothing is recorded until it resumes. It only stops movements (D9), so `canModify` decides. */
export const createPauseRecurrence =
  (deps: RecurrenceDeps): PauseRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input, "stops");
      if (!found.ok) return found;
      const paused = pausedRecurrence(found.value.recurrence, deps.clock.now());
      return paused.ok ? saved(deps, paused.value) : paused;
    });

/**
 * HU-E4-11 ResumeRecurrence: from today on, never back-filling the paused days (P24), if its template still holds and
 * its creator can still record (P26). It turns the movements back on, so only the creator of a recurrence that moves
 * money through their own account resumes it (D9).
 */
export const createResumeRecurrence =
  (deps: RecurrenceDeps): ResumeRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input, "changes");
      if (!found.ok) return found;
      const resumed = resumedRecurrence(
        found.value.recurrence,
        deps.clock.now(),
        todayIn(deps.clock, deps.timeZone),
      );
      if (!resumed.ok) return resumed;
      const checked = await rechecked(deps, found.value.space, resumed.value, { creatorRecords: true });
      return checked.ok ? saved(deps, checked.value) : checked;
    });

/**
 * HU-E4-11 EndRecurrence, D8: logical; the recurrence and its occurrences stay, and nothing else is recorded. It only
 * stops movements (D9), so `canModify` decides.
 */
export const createEndRecurrence =
  (deps: RecurrenceDeps): EndRecurrence =>
  (input) =>
    deps.tm.run(async () => {
      const found = await recurrenceForWrite(deps, input, "stops");
      if (!found.ok) return found;
      const ended = endedRecurrence(found.value.recurrence, deps.clock.now());
      return ended.ok ? saved(deps, ended.value) : ended;
    });

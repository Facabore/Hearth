import { ok, parseTimeZone, type LocalDate, type Result } from "@/shared/kernel";
import { retimed, timeOf, type TimeChange, type TransactionTime } from "../domain/transaction-time";
import type { LedgerDeps } from "./deps";

/** HU-E4-14: what a create request says about when it happened. */
export interface WhenInput {
  readonly userId: string;
  /** The local date; sent with `occurredAt`, it must be that instant's local date in the zone (DateTimeMismatch). */
  readonly date?: LocalDate;
  /** When it happened. Null answers TimeRequired (ruling P66). */
  readonly occurredAt?: Date | null;
  /** An IANA zone; the recorder's when absent. */
  readonly timeZone?: string;
  /** Ruling P66: system paths only (M3-C's recordOccurrence), the date with no time; no request body maps to it. */
  readonly untimed?: true;
}

const sentZone = (raw: string | undefined): Result<string | null> =>
  raw === undefined ? ok(null) : parseTimeZone(raw);

/** HU-E4-14, rulings P41 and P66: the recorder's zone unless one is sent; only an untimed system record reads none. */
export const whenOf = async (
  deps: Pick<LedgerDeps, "clock" | "userTimeZones">,
  input: WhenInput,
): Promise<Result<TransactionTime>> => {
  const sent = sentZone(input.timeZone);
  if (!sent.ok) return sent;
  if (input.untimed === true && input.date !== undefined && input.occurredAt === undefined) {
    return ok({ date: input.date, occurredAt: null, timeZone: null });
  }
  const timeZone = sent.value ?? (await deps.userTimeZones.timeZoneOf(input.userId));
  return timeOf({ date: input.date, occurredAt: input.occurredAt, timeZone, now: deps.clock.now() });
};

/** HU-E4-06, HU-E4-14: the time an edit asks for; the editor's zone only for a new time with no zone anywhere. */
export const editedTime = async (
  deps: Pick<LedgerDeps, "userTimeZones">,
  current: TransactionTime,
  userId: string,
  change: TimeChange,
): Promise<Result<TransactionTime>> => {
  const sent = sentZone(change.timeZone);
  if (!sent.ok) return sent;
  const needsEditorZone =
    change.occurredAt instanceof Date && sent.value === null && current.timeZone === null;
  // `retimed` reads the fallback only in that case; any other value is never used.
  const fallback = needsEditorZone ? await deps.userTimeZones.timeZoneOf(userId) : "UTC";
  return retimed(
    current,
    { date: change.date, occurredAt: change.occurredAt, timeZone: sent.value ?? undefined },
    fallback,
  );
};

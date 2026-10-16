import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { DrizzleTransactionManager } from "@/shared/infrastructure/db/drizzle-transaction-manager";
import { isUuid, type LocalDate } from "@/shared/kernel";
import type { ActiveRecurrence, RecurrenceRepository } from "../application/recurrence-ports";
import type { Recurrence, RecurrenceId, RecurrenceTemplate } from "../domain/recurrence";
import { recurrences } from "./recurrences.schema";

type RecurrenceRow = typeof recurrences.$inferSelect;

/** The payer and accounts of a template in the transaction-shaped columns each type uses (ruling P22). */
const definedColumns = (
  template: RecurrenceTemplate,
): Pick<Partial<RecurrenceRow>, "payerMemberId" | "sourceAccountId" | "destinationAccountId"> => {
  switch (template.type) {
    case "EXPENSE":
      return { payerMemberId: template.payer.memberId, sourceAccountId: template.payer.accountId };
    case "INCOME":
      return { destinationAccountId: template.accountId };
    case "TRANSFER":
      return {
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.destinationAccountId,
      };
    case "FUND_CONTRIBUTION":
      return {
        payerMemberId: template.memberId,
        sourceAccountId: template.sourceAccountId,
        destinationAccountId: template.fundAccountId,
      };
  }
};

/** What an edit may change in a template: an expense's category and split, an income's category (ruling P22). */
const editableColumns = (
  template: RecurrenceTemplate,
): Pick<Partial<RecurrenceRow>, "categoryId" | "split"> => {
  switch (template.type) {
    case "EXPENSE":
      return { categoryId: template.categoryId, split: template.split };
    case "INCOME":
      return { categoryId: template.categoryId };
    case "TRANSFER":
    case "FUND_CONTRIBUTION":
      return {};
  }
};

/** recurrences_shape guarantees the references each type reads here. */
const templateOf = (row: RecurrenceRow): RecurrenceTemplate => {
  switch (row.type) {
    case "EXPENSE":
      return {
        type: "EXPENSE",
        categoryId: row.categoryId!,
        payer: { memberId: row.payerMemberId, accountId: row.sourceAccountId },
        split: row.split,
      };
    case "INCOME":
      return { type: "INCOME", categoryId: row.categoryId!, accountId: row.destinationAccountId! };
    case "TRANSFER":
      return {
        type: "TRANSFER",
        sourceAccountId: row.sourceAccountId!,
        destinationAccountId: row.destinationAccountId!,
      };
    case "FUND_CONTRIBUTION":
      return {
        type: "FUND_CONTRIBUTION",
        fundAccountId: row.destinationAccountId!,
        memberId: row.payerMemberId!,
        sourceAccountId: row.sourceAccountId,
      };
  }
};

const toRecurrence = (row: RecurrenceRow): Recurrence => ({
  id: row.id as RecurrenceId,
  spaceId: row.spaceId,
  description: row.description,
  amount: row.amount,
  currency: row.currency,
  template: templateOf(row),
  schedule: row.schedule,
  mode: row.mode,
  startDate: row.startDate as LocalDate,
  endDate: row.endDate as LocalDate | null,
  dueFrom: row.dueFrom as LocalDate,
  pausedAt: row.pausedAt,
  pauseReason: row.pauseReason,
  endedAt: row.endedAt,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** Every column a recurrence may change after it was defined (D8: nothing is deleted). */
const changeable = (recurrence: Recurrence) => ({
  description: recurrence.description,
  amount: recurrence.amount,
  ...editableColumns(recurrence.template),
  schedule: recurrence.schedule,
  mode: recurrence.mode,
  endDate: recurrence.endDate,
  dueFrom: recurrence.dueFrom,
  pausedAt: recurrence.pausedAt,
  pauseReason: recurrence.pauseReason,
  endedAt: recurrence.endedAt,
  updatedAt: recurrence.updatedAt,
});

const notStored = (recurrence: Recurrence) =>
  `recurrence ${recurrence.id} (${recurrence.template.type}) is not stored in its space`;

export class DrizzleRecurrenceRepository implements RecurrenceRepository {
  constructor(private readonly tm: DrizzleTransactionManager) {}

  async add(recurrence: Recurrence): Promise<void> {
    await this.tm
      .executor()
      .insert(recurrences)
      .values({
        id: recurrence.id,
        spaceId: recurrence.spaceId,
        type: recurrence.template.type,
        currency: recurrence.currency,
        startDate: recurrence.startDate,
        createdBy: recurrence.createdBy,
        createdAt: recurrence.createdAt,
        ...definedColumns(recurrence.template),
        ...changeable(recurrence),
      });
  }

  async find(spaceId: string, recurrenceId: string): Promise<Recurrence | null> {
    // Ids come from URLs; anything that is not a UUID would fail the uuid cast.
    if (!isUuid(spaceId) || !isUuid(recurrenceId)) return null;
    const [row] = await this.tm
      .executor()
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.id, recurrenceId), eq(recurrences.spaceId, spaceId)));
    return row ? toRecurrence(row) : null;
  }

  async list(spaceId: string): Promise<Recurrence[]> {
    if (!isUuid(spaceId)) return [];
    const rows = await this.tm
      .executor()
      .select()
      .from(recurrences)
      .where(eq(recurrences.spaceId, spaceId))
      .orderBy(asc(recurrences.createdAt), asc(recurrences.id));
    return rows.map(toRecurrence);
  }

  async lockForWrite(spaceId: string, recurrenceId: string): Promise<Recurrence | null> {
    if (!isUuid(spaceId) || !isUuid(recurrenceId)) return null;
    // Held until the caller's transaction ends; a locking read that waited returns the row its holder committed.
    // NO KEY UPDATE conflicts with other writers, not with the KEY SHARE an inserted occurrence takes (Task 3c).
    const [row] = await this.tm
      .executor()
      .select()
      .from(recurrences)
      .where(and(eq(recurrences.id, recurrenceId), eq(recurrences.spaceId, spaceId)))
      .for("no key update");
    return row ? toRecurrence(row) : null;
  }

  async save(recurrence: Recurrence): Promise<void> {
    // Id, space and type are the key: a recurrence keeps the space and the type it was defined with (ruling P22).
    const saved = await this.tm
      .executor()
      .update(recurrences)
      .set(changeable(recurrence))
      .where(
        and(
          eq(recurrences.id, recurrence.id),
          eq(recurrences.spaceId, recurrence.spaceId),
          eq(recurrences.type, recurrence.template.type),
        ),
      )
      .returning({ id: recurrences.id });
    // Callers lock the row first and nothing is deleted (D8): no match is a bug, and it must not pass as saved.
    if (saved.length === 0) throw new Error(notStored(recurrence));
  }

  async listActive(today: LocalDate): Promise<ActiveRecurrence[]> {
    const rows = await this.tm
      .executor()
      .select({ id: recurrences.id, spaceId: recurrences.spaceId })
      .from(recurrences)
      .where(
        and(
          // recurrences_active_idx (not paused, not ended, by due_from) serves these three terms.
          isNull(recurrences.pausedAt),
          isNull(recurrences.endedAt),
          lte(recurrences.dueFrom, today),
          // Looser than the domain's statusOf, which also needs a schedule date before the end date (see the port).
          or(isNull(recurrences.endDate), lte(recurrences.dueFrom, recurrences.endDate)),
        ),
      )
      .orderBy(asc(recurrences.createdAt), asc(recurrences.id));
    return rows.map((row) => ({ id: row.id as RecurrenceId, spaceId: row.spaceId }));
  }
}

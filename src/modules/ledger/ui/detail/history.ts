import type { TransactionDto } from "@/shared/ui/api/dto";
import type { AuditEntryDto } from "./transaction-detail";

/** What a line of the history says changed; the sheet words each one (`ledger.history.field`). */
export type HistoryField =
  "payer" | "receiver" | "amount" | "date" | "time" | "account" | "description" | "category" | "split";

/** A change, with its stored values when they read well as "from → to" (a member, an amount, a date, an account). */
export interface HistoryChange {
  readonly field: HistoryField;
  readonly from?: string | null;
  readonly to?: string | null;
}

export interface HistoryLine {
  readonly id: string;
  readonly actorUserId: string;
  readonly actorName: string | null;
  readonly action: "registered" | "changed" | "deleted" | "restored";
  readonly at: string;
  readonly changes: readonly HistoryChange[];
}

const payerOf = (payments: string | null): string | null => {
  try {
    return (JSON.parse(payments ?? "[]") as { memberId: string | null }[])[0]?.memberId ?? null;
  } catch {
    return null;
  }
};

/**
 * The audited keys in the order a line names them (D8), each as the field it words, with its values or without them.
 * An account's leg, the instant and the original amount go with the amount or the date they belong to.
 */
const FIELDS: readonly (readonly [string, HistoryField, boolean])[] = [
  ["payerMemberId", "payer", true],
  ["receivingMemberId", "receiver", true],
  ["payments", "payer", true],
  ["amount", "amount", true],
  ["sourceAmount", "amount", false],
  ["destinationAmount", "amount", false],
  ["originalAmount", "amount", false],
  ["date", "date", true],
  ["occurredAt", "time", false],
  ["timeZone", "time", false],
  ["sourceAccountId", "account", true],
  ["destinationAccountId", "account", true],
  ["description", "description", true],
  ["categoryId", "category", true],
  ["shares", "split", false],
];

const changesOf = (changes: AuditEntryDto["changes"]): HistoryChange[] => {
  const found = new Map<HistoryField, HistoryChange>();
  for (const [key, field, valued] of FIELDS) {
    const change = changes[key];
    if (!change) continue;
    if (key === "payments") {
      // An expense's payments: who paid, when that changed; else only the account it was paid from did.
      const [from, to] = [payerOf(change.from), payerOf(change.to)];
      if (from !== to) found.set("payer", found.get("payer") ?? { field, from, to });
      else if (!found.has("account")) found.set("account", { field: "account" });
      continue;
    }
    // A moment's time goes with its date, when the date changed too.
    if (field === "time" && found.has("date")) continue;
    if (!found.has(field)) found.set(field, valued ? { field, from: change.from, to: change.to } : { field });
  }
  return [...found.values()];
};

/**
 * Ruling P344 (S7, board 2): a movement's history from its audit, newest first, ending with who recorded it. An edit
 * that changed nothing the sheet words (a conversion's own keys) is left out.
 */
export const historyOf = (tx: TransactionDto, entries: readonly AuditEntryDto[]): HistoryLine[] => {
  const lines = entries.flatMap((entry): HistoryLine[] => {
    const action =
      entry.action === "DELETED" ? "deleted" : entry.action === "RESTORED" ? "restored" : "changed";
    const changes = action === "changed" ? changesOf(entry.changes) : [];
    if (action === "changed" && changes.length === 0) return [];
    const { id, actorUserId, at } = entry;
    return [{ id, actorUserId, actorName: entry.actorName ?? null, action, at, changes }];
  });
  lines.sort((a, b) => b.at.localeCompare(a.at));
  return [
    ...lines,
    {
      id: "registered",
      actorUserId: tx.createdBy,
      actorName: null,
      action: "registered",
      at: tx.createdAt,
      changes: [],
    },
  ];
};

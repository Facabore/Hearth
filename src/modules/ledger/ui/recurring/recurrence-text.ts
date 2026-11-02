import { formatMoney, MINUS, type Formats } from "@/shared/ui/format/formatters";
import type { RecurrenceDto, Schedule } from "./recurrence-request";

/** Names the rows read by: account and member ids to their names; a name the viewer cannot read is left out. */
export interface RecurrenceNames {
  readonly accountNames: Readonly<Record<string, string>>;
  readonly memberNames: Readonly<Record<string, string>>;
}

/** The `recurrences` namespace's translator, for its two schedule messages. */
type Translate = (
  key: "schedule.MONTHLY" | "schedule.SEMI_MONTHLY",
  values: Record<string, string | number>,
) => string;

/** The amount with its direction: an expense goes out (−), an income comes in (+); a transfer or contribution moves. */
export const signedAmountOf = (recurrence: Pick<RecurrenceDto, "type" | "amount">, formats: Formats) => {
  const money = formatMoney(recurrence.amount, formats);
  return recurrence.type === "EXPENSE"
    ? `${MINUS}${money}`
    : recurrence.type === "INCOME"
      ? `+${money}`
      : money;
};

/** "Cada mes, el día 1", "Dos veces al mes, los días 15 y 30". */
export const scheduleText = (schedule: Schedule, t: Translate) =>
  schedule.kind === "MONTHLY"
    ? t("schedule.MONTHLY", { day: schedule.day })
    : t("schedule.SEMI_MONTHLY", { day1: schedule.day1, day2: schedule.day2 });

/**
 * Who moves the money, as the row names it (P270): the fund that pays, a shared space's payer and their account, the
 * receiving account of an income, a transfer's two accounts.
 */
export const partyOf = (
  recurrence: RecurrenceDto,
  { accountNames, memberNames }: RecurrenceNames,
  options: { readonly shared: boolean; readonly transfer: (from: string, to: string) => string },
): string => {
  const account = (id: string | null) => (id ? (accountNames[id] ?? "") : "");
  const member = (id: string | null) => (options.shared && id ? (memberNames[id] ?? "") : "");
  switch (recurrence.type) {
    case "INCOME":
      return account(recurrence.destinationAccountId);
    case "TRANSFER":
      return options.transfer(account(recurrence.sourceAccountId), account(recurrence.destinationAccountId));
    default:
      return [member(recurrence.payerMemberId), account(recurrence.sourceAccountId)]
        .filter(Boolean)
        .join(" · ");
  }
};

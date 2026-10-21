import type { useTranslations } from "next-intl";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import type { SplitCheck } from "./split-math";
import type { SplitDraft } from "./split-request";

export type SplitFailure = Extract<SplitCheck, { ok: false }>;

/**
 * An unreadable value of a row nobody has edited yet is not an error to show: the person has not got to it (a value is
 * recorded the first time its row is edited, even if it is then emptied). Listo stays disabled and the hint is neutral.
 */
export const isUntouched = (failure: SplitFailure, draft: SplitDraft): boolean =>
  failure.reason === "unreadable" && !(failure.memberId in draft.values);

/**
 * What is wrong with a split, in the person's words ("Falta asignar 10 %"). The sheet's status line and the record
 * form's split row say the same thing, so the sentence is built here once.
 */
export const splitFailureMessage = (
  failure: SplitFailure,
  t: ReturnType<typeof useTranslations<"ledger.split">>,
  context: {
    readonly currency: string;
    readonly formats: Formats;
    /** The member's label, or an empty string for someone who is not in the space. */
    readonly nameOf: (memberId: string) => string;
  },
): string => {
  switch (failure.reason) {
    case "percentShort":
    case "percentOver":
      return t(`invalid.${failure.reason}`, { percent: formatNumber(failure.percent, context.formats) });
    case "exactShort":
    case "exactOver":
      return t(`invalid.${failure.reason}`, {
        amount: formatMoney({ amount: failure.amount, currency: context.currency }, context.formats),
      });
    case "unreadable":
      return t("invalid.unreadable", { name: context.nameOf(failure.memberId) });
    case "noParticipants":
      return t("invalid.noParticipants");
    case "tooSmall":
      return t("invalid.tooSmall");
  }
};

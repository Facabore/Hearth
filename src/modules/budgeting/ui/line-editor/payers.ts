import type { PlanLineDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import type { Funding } from "./line-draft";

export type PayersScope = NonNullable<PlanLineDto["payersScope"]>;

/**
 * P328: how a line is paid, as the sheet "¿Cómo se paga …?" offers it. PAYERS is "Lo pagan directo": named members pay
 * it, for the fund in a space with one (D26) and as plain payers without one; EACH is whoever records the expense.
 */
export type PayMode = "FUND" | "PAYERS" | "EACH" | "SAVINGS";

/**
 * What the sheet answers: the mode and, for PAYERS, who and how long. The caller turns it into a `PayChoice`, so the
 * sheet's chunk carries none of this module's code (it stays apart from the editor's route chunk).
 */
export interface SheetChoice {
  readonly mode: PayMode;
  readonly payerMemberIds: readonly string[];
  readonly payersScope: PayersScope;
}

/** The part of a line draft the sheet edits. */
export interface PayChoice {
  readonly funding: Funding;
  readonly payerMemberIds: readonly string[];
  readonly payersScope: PayersScope;
}

export const payModeOf = (choice: Pick<PayChoice, "funding" | "payerMemberIds">): PayMode =>
  choice.funding === "SAVINGS"
    ? "SAVINGS"
    : choice.payerMemberIds.length > 0
      ? "PAYERS"
      : choice.funding === "SHARED_FUND"
        ? "FUND"
        : "EACH";

/**
 * D26: "Lo pagan directo" is a fund line with payers where the space has a shared fund, and a direct line with payers
 * where it has none; the other modes name nobody.
 */
export const choiceFor = (
  mode: PayMode,
  payers: readonly string[],
  scope: PayersScope,
  hasFund: boolean,
): PayChoice => {
  if (mode === "PAYERS") {
    return { funding: hasFund ? "SHARED_FUND" : "DIRECT", payerMemberIds: payers, payersScope: scope };
  }
  const funding: Funding = mode === "FUND" ? "SHARED_FUND" : mode === "SAVINGS" ? "SAVINGS" : "DIRECT";
  return { funding, payerMemberIds: [], payersScope: "EVERY_PERIOD" };
};

/** D26, P261: who may pay a line: the current members but the VIEWERs, guests included, in join order. */
export const payerCandidates = (members: readonly SpaceMemberDto[]): SpaceMemberDto[] =>
  members.filter((member) => member.role !== "VIEWER");

/** "Ana", "Ana y Juan", "Ana, Juan y Sofía": `and` is the language's word for the last join. */
export const joinNames = (names: readonly string[], and: string): string =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} ${and} ${names.at(-1)}`;

/** The display names of `ids` among `members`, in the order the line names them; a former member is left out. */
export const namesOf = (ids: readonly string[], members: readonly SpaceMemberDto[]): string[] =>
  ids.flatMap((id) => {
    const member = members.find((m) => m.id === id);
    return member ? [member.displayName] : [];
  });

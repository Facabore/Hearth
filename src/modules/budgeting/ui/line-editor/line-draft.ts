import type { MoneyDto, PlanLineDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { minorOf, parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { decimalOf, formatNumber, type Formats, type NumberFormat } from "@/shared/ui/format/formatters";

export type Funding = PlanLineDto["funding"];
export type RolloverMode = PlanLineDto["rolloverMode"];

export interface LineDraft {
  readonly name: string;
  readonly planned: string;
  readonly funding: Funding;
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  readonly savingsAccountIds: readonly string[];
}

/** HU-E6-03: a new line is DIRECT, RESET and not the catch-all until the person says otherwise. */
export const NEW_LINE: LineDraft = {
  name: "",
  planned: "",
  funding: "DIRECT",
  rolloverMode: "RESET",
  isCatchAll: false,
  savingsAccountIds: [],
};

export const lineDraftOf = (line: PlanLineDto | null, formats: Pick<Formats, "numberFormat">): LineDraft =>
  line === null
    ? NEW_LINE
    : {
        name: line.name,
        planned: formatNumber(
          decimalOf(line.plannedAmount.amount, currencyOf(line.plannedAmount.currency).exponent),
          formats,
        ),
        funding: line.funding,
        rolloverMode: line.rolloverMode,
        isCatchAll: line.isCatchAll,
        savingsAccountIds: line.savingsAccountIds,
      };

export interface LineBody {
  readonly name: string;
  readonly plannedAmount: MoneyDto;
  readonly funding: Funding;
  readonly rolloverMode: RolloverMode;
  readonly isCatchAll: boolean;
  readonly savingsAccountIds: string[];
}

/** Spec 5.4: a SAVINGS line consumes transfers into its accounts, so it is never the catch-all; others name none. */
export const lineBodyOf = (
  draft: LineDraft,
  currency: string,
  numberFormat: NumberFormat,
): { ok: true; body: LineBody } | { ok: false; field: "planned" } => {
  const decimal = parseDecimal(draft.planned, numberFormat);
  const minor = decimal === null ? null : minorOf(decimal, currencyOf(currency).exponent);
  if (minor === null) return { ok: false, field: "planned" };
  const savings = draft.funding === "SAVINGS";
  return {
    ok: true,
    body: {
      name: draft.name.trim(),
      plannedAmount: { amount: minor, currency },
      funding: draft.funding,
      rolloverMode: draft.rolloverMode,
      isCatchAll: savings ? false : draft.isCatchAll,
      savingsAccountIds: savings ? [...draft.savingsAccountIds] : [],
    },
  };
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/** HU-E6-03: an edit sends only the fields that changed (the PATCH keeps the rest). */
export const lineChanges = (line: PlanLineDto, body: LineBody): Partial<LineBody> => ({
  ...(body.name !== line.name ? { name: body.name } : {}),
  ...(body.plannedAmount.amount !== line.plannedAmount.amount ? { plannedAmount: body.plannedAmount } : {}),
  ...(body.funding !== line.funding ? { funding: body.funding } : {}),
  ...(body.rolloverMode !== line.rolloverMode ? { rolloverMode: body.rolloverMode } : {}),
  ...(body.isCatchAll !== line.isCatchAll ? { isCatchAll: body.isCatchAll } : {}),
  ...(!sameSet(body.savingsAccountIds, line.savingsAccountIds)
    ? { savingsAccountIds: body.savingsAccountIds }
    : {}),
});

export type LineField = "name" | "planned" | "savings" | "catchAll";

const BY_CODE: Readonly<Record<string, LineField>> = {
  BudgetLineNameTaken: "name",
  InvalidBudgetLineName: "name",
  InvalidPlannedAmount: "planned",
  PlanExceedsCapacity: "planned",
  CurrencyMismatch: "planned",
  SavingsAccountRequired: "savings",
  InvalidSavingsAccount: "savings",
  SavingsAccountAlreadyUsed: "savings",
  AccountNotFound: "savings",
  AccountArchived: "savings",
  CatchAllLineAlreadySet: "catchAll",
  SavingsLineNotMappable: "catchAll",
};
const BY_PATH: Readonly<Record<string, LineField>> = {
  name: "name",
  plannedAmount: "planned",
  savingsAccountIds: "savings",
  isCatchAll: "catchAll",
};

/** Ruling P118: a code or a validation path names its field; anything else is shown above the button. */
export const lineFieldOf = (problem: Problem): LineField | "form" =>
  BY_CODE[problem.code] ?? BY_PATH[problem.errors[0]?.path.split(".")[0] ?? ""] ?? "form";

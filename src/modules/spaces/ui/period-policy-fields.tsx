"use client";

import { useTranslations } from "next-intl";
import { ChoiceGroup, cn, Icon } from "@/shared/ui";

export type PeriodKind = "MONTHLY" | "SEMI_MONTHLY";

/** What the person typed: the cut-off days as text, so a field can be empty while it is edited. */
export interface PeriodDraft {
  readonly kind: PeriodKind;
  readonly day: string;
  readonly day1: string;
  readonly day2: string;
}

/** HU-E1-04: a new space counts its budget by calendar month (MONTHLY(1)) until the person picks otherwise. */
export const DEFAULT_PERIOD_DRAFT: PeriodDraft = { kind: "MONTHLY", day: "1", day1: "1", day2: "16" };

/**
 * The policy `POST /api/v1/spaces` takes. The days go as typed: the domain checks them (InvalidPeriodPolicy), as it
 * does for a settings change, so an empty field reaches it as 0 and is refused there.
 */
export const periodPolicyOf = (draft: PeriodDraft) =>
  draft.kind === "MONTHLY"
    ? { kind: "MONTHLY" as const, day: Number(draft.day) }
    : { kind: "SEMI_MONTHLY" as const, day1: Number(draft.day1), day2: Number(draft.day2) };

const KINDS: readonly PeriodKind[] = ["MONTHLY", "SEMI_MONTHLY"];
type DayField = "day" | "day1" | "day2";

/**
 * #240 (ruling P275), the board "Crear espacio compartido desde el selector": "Período del presupuesto" as Mensual or
 * Quincenal, the cut-off day beside its label (two for Quincenal), then a line with the policy as Miembros will name
 * it ("Mensual, corte el 1"). No endpoint resolves periods from a policy before the space exists, and period
 * boundaries are the domain's date math, so the line names the policy, not the coming period's dates.
 *
 * The route already holds ChoiceGroup; the days are a plain digits field, not NumberField, to keep its script small.
 */
export function PeriodPolicyFields({
  draft,
  onChange,
  error,
}: {
  readonly draft: PeriodDraft;
  readonly onChange: (draft: PeriodDraft) => void;
  readonly error?: string;
}) {
  const t = useTranslations("spaces.new");
  const policy = useTranslations("members.policy");
  // The catalogs are at their script budget (ADR 0004): "Día de corte" is the accounts' own label.
  const accounts = useTranslations("accounts.field");
  const days: readonly DayField[] = draft.kind === "MONTHLY" ? ["day"] : ["day1", "day2"];
  const typed = days.every((field) => draft[field] !== "");
  const described = [typed ? "space-period-preview" : null, error ? "space-period-error" : null]
    .filter(Boolean)
    .join(" ");

  return (
    <fieldset className="flex flex-col gap-2">
      <legend id="space-period" className="mb-2 text-sm font-medium text-ink">
        {t("period")}
      </legend>
      <ChoiceGroup
        label={t("period")}
        labelledBy="space-period"
        value={draft.kind}
        options={KINDS.map((kind) => ({ value: kind, label: t(`periodKind.${kind}`) }))}
        onValueChange={(kind) => onChange({ ...draft, kind })}
      />
      {days.map((field) => (
        <div key={field} className="flex min-h-[52px] items-center justify-between gap-3">
          <label htmlFor={`space-${field}`} className="text-[15px] text-ink">
            {field === "day" ? accounts("cutOffDay") : t(`cutDay.${field}`)}
          </label>
          <input
            id={`space-${field}`}
            inputMode="numeric"
            autoComplete="off"
            value={draft[field]}
            // A day of the month: digits only, two at most; the domain checks the range.
            onChange={(event) =>
              onChange({ ...draft, [field]: event.target.value.replace(/\D/g, "").slice(0, 2) })
            }
            aria-invalid={error ? true : undefined}
            aria-describedby={described || undefined}
            className={cn(
              "h-11 w-[88px] rounded-xl border bg-surface text-center text-base font-medium text-ink",
              error ? "border-danger" : "border-field",
            )}
          />
        </div>
      ))}
      {typed ? (
        <p id="space-period-preview" className="text-[13px] text-muted first-letter:uppercase">
          {draft.kind === "MONTHLY"
            ? policy("MONTHLY", { day: draft.day })
            : policy("SEMI_MONTHLY", { day1: draft.day1, day2: draft.day2 })}
        </p>
      ) : null}
      {error ? (
        <p id="space-period-error" className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

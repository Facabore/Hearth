"use client";

import { useTranslations } from "next-intl";
import { useId, type Ref } from "react";
import { ChoiceGroup, Icon, NumberField } from "@/shared/ui";
import { currencyOf } from "@/shared/ui/format/currencies";
import type { NumberRule } from "@/shared/ui/format/number-input";
import type { MoneyDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatMoney, formatNumber, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import type { AllocationDraft, AllocationRule, Preview } from "./allocation";

const RULES: readonly AllocationRule[] = ["PROPORTIONAL", "PERCENT", "FIXED", "NONE"];

/**
 * HU-E9-08, the LineEditor artboard's lower half: who answers for the line. The rule is one of four; each member's
 * row previews what they would be assigned (ruling P211, a preview the server's answer overrides on save). A sum that
 * does not hold shows `errors.InvalidAllocation` with the sum; Not allocated shows no member rows.
 */
export function AllocationEditor({
  draft,
  onChange,
  preview,
  members,
  formats,
  currency,
  planned,
  ref,
}: {
  readonly draft: AllocationDraft;
  readonly onChange: (draft: AllocationDraft) => void;
  readonly preview: Preview;
  readonly members: readonly SpaceMemberDto[];
  readonly formats: Formats;
  readonly currency: string;
  readonly planned: MoneyDto;
  /** The section itself, so a blocked save can move focus to it. */
  readonly ref?: Ref<HTMLElement>;
}) {
  const t = useTranslations("budgeting.allocation");
  const tRule = useTranslations("budgeting.rule");
  const messageOf = useProblemMessage();
  const ids = useId();
  const editable = draft.rule === "PERCENT" || draft.rule === "FIXED";
  const assigned = preview.kind === "assigned" ? preview.amounts : null;
  const sample = draft.rule === "PERCENT" ? "42.5" : "300000";
  const example = formatNumber(sample, formats);
  // Issue #164: a percent takes the API's two decimals, a fixed amount the currency's.
  const rule: NumberRule =
    draft.rule === "PERCENT"
      ? { kind: "decimal", numberFormat: formats.numberFormat, decimals: 2 }
      : { kind: "money", numberFormat: formats.numberFormat, decimals: currencyOf(currency).exponent };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby={`${ids}-title`}
      className="flex flex-col gap-3 outline-none"
    >
      <h2 id={`${ids}-title`} className="text-base font-semibold text-ink">
        {t("title")}
      </h2>
      <ChoiceGroup
        label={t("rule")}
        // F16 (#224): one rule per row, so "Según aportes" and "Monto fijo" never break inside a narrow cell.
        layout="list"
        value={draft.rule}
        options={RULES.map((value) => ({ value, label: tRule(value) }))}
        onValueChange={(rule) => onChange({ rule, values: draft.values })}
      />
      <p className="text-sm text-muted">
        {t(`note.${draft.rule}`, { planned: formatMoney(planned, formats) })}
      </p>

      {draft.rule !== "NONE"
        ? members.map((member) => (
            <div
              key={member.id}
              role="group"
              aria-labelledby={`${ids}-${member.id}`}
              className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-3"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  id={`${ids}-${member.id}`}
                  className="min-w-0 font-semibold [overflow-wrap:anywhere] text-ink"
                >
                  {member.displayName}
                </span>
                <span className="shrink-0 font-semibold tabular-nums text-ink">
                  {assigned?.[member.id] !== undefined
                    ? formatMoney({ amount: assigned[member.id]!, currency }, formats)
                    : "—"}
                </span>
              </div>
              {editable ? (
                <NumberField
                  id={`${ids}-${member.id}-value`}
                  label={t("value", { name: member.displayName })}
                  {...rule}
                  example={sample}
                  unit={draft.rule === "PERCENT" ? "%" : undefined}
                  symbol={draft.rule === "PERCENT" ? undefined : currencyOf(currency).symbol}
                  value={draft.values[member.id] ?? ""}
                  onChange={(value) =>
                    onChange({ rule: draft.rule, values: { ...draft.values, [member.id]: value } })
                  }
                  error={
                    preview.kind === "unreadable" && preview.memberId === member.id
                      ? t("unreadable", { example })
                      : undefined
                  }
                />
              ) : null}
            </div>
          ))
        : null}

      {preview.kind === "invalid" ? (
        <div role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          <p>
            {
              messageOf({ code: "InvalidAllocation", status: 422, requestId: null, errors: [], field: null })
                .message
            }{" "}
            {t("sum", {
              sum:
                preview.unit === "percent"
                  ? formatPercent(preview.sum, formats)
                  : formatMoney({ amount: preview.sum, currency }, formats),
            })}
          </p>
        </div>
      ) : null}
      {preview.kind === "noCapacity" ? (
        <div role="alert" className="flex items-start gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          <p>{t("noCapacity")}</p>
        </div>
      ) : null}
    </section>
  );
}

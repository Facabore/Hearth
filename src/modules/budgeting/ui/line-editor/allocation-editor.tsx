"use client";

import { useTranslations } from "next-intl";
import { useId, type Ref } from "react";
import { ChoiceGroup, Icon, TextField } from "@/shared/ui";
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
  const example = formatNumber(draft.rule === "PERCENT" ? "42.5" : "300000", formats);

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
        layout="grid"
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
                <TextField
                  id={`${ids}-${member.id}-value`}
                  label={t("value", { name: member.displayName })}
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft.values[member.id] ?? ""}
                  onChange={(event) =>
                    onChange({
                      rule: draft.rule,
                      values: { ...draft.values, [member.id]: event.target.value },
                    })
                  }
                  trailing={
                    draft.rule === "PERCENT" ? (
                      <span aria-hidden="true" className="px-2 text-muted">
                        %
                      </span>
                    ) : undefined
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

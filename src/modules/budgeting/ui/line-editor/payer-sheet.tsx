"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button, Icon, Sheet } from "@/shared/ui";
import type { SpaceMemberDto } from "@/shared/ui/api/dto";
import {
  choiceFor,
  joinNames,
  namesOf,
  payModeOf,
  type PayChoice,
  type PayMode,
  type PayersScope,
} from "./payers";

const SCOPES: readonly PayersScope[] = ["EVERY_PERIOD", "THIS_PERIOD"];

/**
 * P328, board "Se paga desde · hoja · #316": one sheet answers how a line is paid. "Lo pagan directo" opens a checkbox
 * per member who may pay it (one or more), and "¿Hasta cuándo?" says whether the plan's copy keeps them (every month)
 * or this period only. "Va al ahorro" stays, though the board omits it: it keeps today's savings-line choice. A payer
 * who does not manage the plan sees only the payers and their scope, the only things they may change (D26).
 */
export function PayerSheet({
  open,
  onOpenChange,
  lineName,
  value,
  modes,
  hasFund,
  candidates,
  viewerMemberId,
  period,
  monthly,
  shares,
  onDone,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly lineName: string;
  readonly value: PayChoice;
  /** The modes offered, in the board's order; just PAYERS for a payer who does not manage the plan. */
  readonly modes: readonly PayMode[];
  readonly hasFund: boolean;
  /** The members who may pay the line (no VIEWERs), in join order. */
  readonly candidates: readonly SpaceMemberDto[];
  readonly viewerMemberId: string | null;
  /** The plan's period in a word ("noviembre"), for "Solo noviembre". */
  readonly period: string;
  readonly monthly: boolean;
  /** "Ana 40 % · Juan 35 % · Sofía 25 %": who answers for the line; null when nobody has a share. */
  readonly shares: string | null;
  readonly onDone: (choice: PayChoice) => void;
}) {
  const t = useTranslations("budgeting.lineEditor.pay");
  const ids = useId();
  const [mode, setMode] = useState<PayMode>(() => payModeOf(value));
  const [payers, setPayers] = useState<readonly string[]>(value.payerMemberIds);
  const [scope, setScope] = useState<PayersScope>(value.payersScope);
  const [missing, setMissing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  // Each opening starts from the line's draft, not from what was left behind.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setMode(payModeOf(value));
      setPayers(value.payerMemberIds);
      setScope(value.payersScope);
      setMissing(false);
    }
  }
  const payersOnly = modes.length === 1;
  const toggle = (id: string, on: boolean) => {
    setMissing(false);
    // The payers keep the order of the member list, whoever was ticked first.
    setPayers((current) =>
      candidates.map((m) => m.id).filter((other) => (other === id ? on : current.includes(other))),
    );
  };
  const done = () => {
    // A payer who does not manage the plan may clear the payers; "Lo pagan directo" needs someone.
    if (mode === "PAYERS" && payers.length === 0 && !payersOnly) {
      setMissing(true);
      return;
    }
    onDone(
      payersOnly && payers.length === 0
        ? { ...value, payerMemberIds: [] }
        : choiceFor(mode, payers, scope, hasFund),
    );
    onOpenChange(false);
  };
  const named = joinNames(namesOf(payers, candidates), t("and"));
  const checkboxes = (
    <fieldset
      aria-describedby={missing ? `${ids}-missing` : undefined}
      className={payersOnly ? "flex flex-col" : "flex flex-col pl-8"}
    >
      <legend className="sr-only">{t("payers")}</legend>
      {candidates.map((member) => (
        <label key={member.id} className="flex min-h-11 cursor-pointer items-center gap-3 text-base text-ink">
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-accent"
            checked={payers.includes(member.id)}
            onChange={(event) => toggle(member.id, event.target.checked)}
          />
          <span className="[overflow-wrap:anywhere]">
            {member.id === viewerMemberId ? t("you", { name: member.displayName }) : member.displayName}
          </span>
        </label>
      ))}
      {missing ? (
        <p id={`${ids}-missing`} className="flex items-center gap-1.5 text-sm text-danger">
          <Icon name="alert" size={16} />
          {t("chooseSomeone")}
        </p>
      ) : null}
    </fieldset>
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { line: lineName })}
      description={shares === null ? undefined : t("keeps", { shares })}
      footer={
        <Button size="lg" onClick={done}>
          {t("done")}
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {payersOnly ? (
          checkboxes
        ) : (
          <div role="radiogroup" aria-label={t("title", { line: lineName })} className="flex flex-col gap-1">
            {modes.map((option) => {
              const id = `${ids}-${option}`;
              const hint = option === "PAYERS" && !hasFund ? "PAYERS_NO_FUND" : option;
              return (
                <div key={option} className="flex flex-col">
                  <label htmlFor={id} className="flex min-h-11 cursor-pointer items-start gap-3 py-2">
                    <input
                      id={id}
                      type="radio"
                      name={`${ids}-mode`}
                      checked={mode === option}
                      onChange={() => {
                        setMode(option);
                        setMissing(false);
                      }}
                      aria-labelledby={`${id}-label`}
                      aria-describedby={`${id}-hint`}
                      className="mt-0.5 size-5 shrink-0 accent-accent"
                    />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span
                        id={`${id}-label`}
                        className={`[overflow-wrap:anywhere] text-ink ${mode === option ? "font-semibold" : ""}`}
                      >
                        {t(`mode.${option}`)}
                      </span>
                      <span id={`${id}-hint`} className="text-sm [overflow-wrap:anywhere] text-muted">
                        {t(`modeHint.${hint}`)}
                      </span>
                    </span>
                  </label>
                  {option === "PAYERS" && mode === "PAYERS" ? checkboxes : null}
                </div>
              );
            })}
          </div>
        )}
        {mode === "PAYERS" ? (
          <div className="flex flex-col gap-2">
            <h3 id={`${ids}-until`} className="text-sm font-medium text-ink">
              {t("until")}
            </h3>
            <div role="radiogroup" aria-labelledby={`${ids}-until`} className="flex flex-wrap gap-2">
              {SCOPES.map((option) => (
                <label
                  key={option}
                  className="flex min-h-11 cursor-pointer items-center rounded-full border border-line bg-surface px-4 text-sm text-ink has-[:checked]:border-transparent has-[:checked]:bg-accent-soft has-[:checked]:font-semibold has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
                >
                  <input
                    type="radio"
                    name={`${ids}-scope`}
                    className="sr-only"
                    checked={scope === option}
                    onChange={() => setScope(option)}
                  />
                  {t(`scope.${option}`, { period, monthly: String(monthly) })}
                </label>
              ))}
            </div>
            {payers.length > 0 ? (
              <p className="text-sm [overflow-wrap:anywhere] text-muted">
                {t("alsoChange", { names: named, count: payers.length })}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}

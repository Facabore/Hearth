"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge, Button, ChoiceGroup } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { LockBadge } from "./lock-badge";
import { SavedFlash } from "./saved-flash";

export interface PreferenceRowProps<T extends string> {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: ReactNode }[];
  readonly state: "locked" | "default" | "custom";
  readonly onChoose: (value: T) => void;
  readonly onReset: () => void;
  readonly problem: Problem | null;
  /** U5: this field was just stored. */
  readonly saved?: boolean;
}

/** One preference: a group named by its legend, Default / Reset / the lock on its line, its error under it. */
export function PreferenceRow<T extends string>({
  id,
  label,
  value,
  options,
  state,
  onChoose,
  onReset,
  problem,
  saved = false,
}: PreferenceRowProps<T>) {
  const t = useTranslations("settings");
  const messageOf = useProblemMessage();
  return (
    <fieldset className="relative flex flex-col gap-2" aria-describedby={problem ? `${id}-error` : undefined}>
      <legend className="float-left text-sm font-medium text-ink">{label}</legend>
      {/* U5: one slot of a fixed height and a right edge for Predeterminado, Restablecer and the lock, so none moves. */}
      <div
        data-testid="preference-state"
        className="float-right flex h-11 min-w-[7.5rem] items-center justify-end"
      >
        {state === "locked" ? (
          <LockBadge />
        ) : state === "default" ? (
          <Badge>{t("default")}</Badge>
        ) : (
          <Button variant="ghost" size="compact" onClick={onReset}>
            {t("reset")}
          </Button>
        )}
      </div>
      <SavedFlash show={saved} className="-top-5" />
      <div className="clear-both">
        <ChoiceGroup
          label={label}
          value={value}
          options={options}
          onValueChange={onChoose}
          disabled={state === "locked"}
        />
      </div>
      {problem ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {messageOf(problem).message}
        </p>
      ) : null}
    </fieldset>
  );
}

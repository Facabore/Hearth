"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Badge, Button, ChoiceGroup } from "@/shared/ui";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { LockBadge } from "./lock-badge";

export interface PreferenceRowProps<T extends string> {
  readonly id: string;
  readonly label: string;
  readonly value: T;
  readonly options: readonly { value: T; label: ReactNode }[];
  readonly state: "locked" | "default" | "custom";
  readonly onChoose: (value: T) => void;
  readonly onReset: () => void;
  readonly problem: Problem | null;
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
}: PreferenceRowProps<T>) {
  const t = useTranslations("settings");
  const messageOf = useProblemMessage();
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={problem ? `${id}-error` : undefined}>
      <legend className="float-left text-sm font-medium text-ink">{label}</legend>
      <div className="float-right">
        {state === "locked" ? (
          <LockBadge />
        ) : state === "default" ? (
          <Badge>{t("default")}</Badge>
        ) : (
          <Button variant="ghost" className="h-11 px-2 text-sm" onClick={onReset}>
            {t("reset")}
          </Button>
        )}
      </div>
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

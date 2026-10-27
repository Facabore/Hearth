"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { accountFieldOf, type AccountField } from "./account-fields";

export type Where = "name" | "opening" | AccountField;

const AMOUNTS: readonly Where[] = ["opening", "creditLimit", "principal"];
/** What a number that is not an amount looks like, as a decimal, in the error that says it could not be read. */
const EXAMPLES: Partial<Record<Where, string>> = {
  monthlyRate: "1.89",
  annualRate: "12.5",
  cutOffDay: "25",
  paymentDay: "15",
  termDays: "90",
  termMonths: "36",
};

/**
 * The create and edit forms' field errors: a number that cannot be read (an amount, or a rate or count with its own
 * example), else the API's problem on the field it names (ruling P118). A field's error is about its last value: it
 * goes as soon as that field changes, never waiting for the next save.
 */
export const useAccountErrors = (formats: Formats) => {
  const t = useTranslations("accounts");
  const messageOf = useProblemMessage();
  const [unreadable, setUnreadable] = useState<Where | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const where = problem ? accountFieldOf(problem) : null;
  const errorOf = (field: Where) =>
    unreadable === field
      ? AMOUNTS.includes(field)
        ? t("amountUnreadable", { example: formatNumber("1500000", formats) })
        : t("numberUnreadable", { example: formatNumber(EXAMPLES[field] ?? "1.5", formats) })
      : where === field && problem
        ? messageOf(problem).message
        : undefined;
  const clear = (field: Where) => {
    if (unreadable === field) setUnreadable(null);
    if (problem && where === field) setProblem(null);
  };
  return { problem, setProblem, setUnreadable, where, errorOf, clear };
};

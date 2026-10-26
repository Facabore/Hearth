"use client";

import { useTranslations } from "next-intl";
import type { Problem } from "./problem";

/**
 * HU-E9-02: a problem in the person's language. A code with its own message says what to do; a code without one shows
 * `errors.Unknown` and, when the API sent one, the request id to quote. A raw code is never shown.
 */
export const useProblemMessage = (): ((problem: Problem) => {
  message: string;
  reference: string | null;
}) => {
  const t = useTranslations("errors");
  return (problem) => {
    const known = t.has(problem.code as "Unknown");
    return {
      // Ruling P248, issue #158: a message may name the period a problem points at (the source to close, or the
      // closed copy that blocks activation); the others have no placeholder to fill.
      message: known
        ? t(problem.code as "Unknown", { period: problem.sourcePeriod ?? problem.copyPeriod ?? "" })
        : t("Unknown"),
      reference:
        !known && problem.requestId !== null ? t("reference", { requestId: problem.requestId }) : null,
    };
  };
};

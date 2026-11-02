"use client";

import { useTranslations } from "next-intl";
import { createContext, useContext } from "react";
import type { Problem } from "./problem";

/**
 * Issue #232 (ruling P283): the period a problem names, in words ("octubre 2026"), set by the screen that knows its
 * dates. A problem carries only the period's label, and naming a label needs its dates and the person's formats.
 */
export const ProblemPeriod = createContext<string | null>(null);

/**
 * HU-E9-02: a problem in the person's language. A code with its own message says what to do; a code without one shows
 * `errors.Unknown` and, when the API sent one, the request id to quote. A raw code is never shown.
 */
export const useProblemMessage = (): ((problem: Problem) => {
  message: string;
  reference: string | null;
}) => {
  const t = useTranslations("errors");
  const named = useContext(ProblemPeriod);
  return (problem) => {
    const known = t.has(problem.code as "Unknown");
    return {
      // Ruling P248, issue #158: a message may name the period a problem points at (the source to close, or the
      // closed copy that blocks activation); the others have no placeholder to fill. Issue #232: the screen's named
      // period wins; the bare label is left only when the screen could not read the period's dates.
      message: known
        ? t(problem.code as "Unknown", { period: named ?? problem.sourcePeriod ?? problem.copyPeriod ?? "" })
        : t("Unknown"),
      reference:
        !known && problem.requestId !== null ? t("reference", { requestId: problem.requestId }) : null,
    };
  };
};

"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";
import { rememberDropped } from "./copy-notice";
import { planWrite } from "./plan-write";

/**
 * HU-E9-10 and HU-E9-08 (the NoPlan artboard): create a period's plan, or copy the previous one, then open the
 * planner. A copy hands what it left out to the planner once (ruling P209). Offered to managers only (ruling P207).
 * Ruling P311: "Crear plan" leads; the copy, named by the period it starts from, shows only when that period has a
 * plan, and without one a line says when it will.
 */
export function PlanStartActions({
  spaceId,
  period,
  previous,
  api: injected,
}: {
  readonly spaceId: string;
  readonly period: string;
  /**
   * The previous period in words when it has a plan to copy, null when it has none, absent while not known, and `true`
   * when it could not be read: the copy is offered unnamed, and the API refuses it if there is nothing to copy.
   */
  readonly previous?: string | true | null | undefined;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting.start");
  const router = useRouter();
  const messageOf = useProblemMessage();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  const start = async (copy: boolean) => {
    // A second click can arrive before the re-render that disables the buttons.
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    const result = await planWrite(
      api.POST("/api/v1/spaces/{spaceId}/plans", {
        params: { path: { spaceId } },
        body: copy ? { period, copyFrom: "previous" } : { period },
      }),
    );
    if (result.ok) {
      if (copy && result.plan.dropped !== undefined) rememberDropped(result.plan.id, result.plan.dropped);
      router.push(`/spaces/${spaceId}/plans/${result.plan.id}`);
    } else {
      setProblem(result.problem);
      // Someone just created the plan: the dashboard shows it after a refresh.
      if (result.problem.code === "PlanAlreadyExists") router.refresh();
    }
    inFlight.current = false;
    setPending(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <Button size="lg" disabled={pending} onClick={() => void start(false)}>
        {t("create")}
      </Button>
      {previous ? (
        <>
          <Button
            size="lgFlow"
            variant="secondary"
            className="min-h-14 py-3"
            disabled={pending}
            onClick={() => void start(true)}
          >
            {previous === true ? t("copyPrevious") : t("copy", { period: previous })}
          </Button>
          <p className="text-sm text-muted">{t("copyHint")}</p>
        </>
      ) : previous === null ? (
        <p className="text-sm text-muted">{t("noPrevious")}</p>
      ) : null}
      {problem !== null ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(problem).message}
        </p>
      ) : null}
    </div>
  );
}

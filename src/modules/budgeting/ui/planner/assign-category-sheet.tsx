import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { Button, ProblemNotice, Sheet } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import { RadioCard } from "../line-editor/radio-card";
import { takesCategories } from "../plan-access";
import { ifMatch, planWrite, rereadPlan } from "../plan-write";

/**
 * Issue #264 (H13): maps one category that no line counts to the line the person picks, keeping that line's own
 * categories. A savings line takes no categories (ruling P212), so it is not offered. A refusal stays in the sheet; a
 * stale version reads the plan again so a retry carries the new one (ruling P206).
 */
export function AssignCategorySheet({
  spaceId,
  plan,
  category,
  formats,
  api,
  onAssigned,
  onPlan,
  onClose,
}: {
  readonly spaceId: string;
  readonly plan: BudgetPlanDto;
  /** The category being assigned, or null while the sheet is closed. */
  readonly category: { readonly id: string; readonly name: string } | null;
  readonly formats: Formats;
  readonly api: Api;
  readonly onAssigned: (plan: BudgetPlanDto) => void;
  /** A newer plan read after a stale write. */
  readonly onPlan: (plan: BudgetPlanDto) => void;
  readonly onClose: () => void;
}) {
  const t = useTranslations("budgeting");
  const ids = useId();
  const [lineId, setLineId] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const lines = plan.lines.filter(takesCategories);
  // A plan read again may no longer hold the line picked before; then nothing is picked.
  const picked = lines.find((line) => line.id === lineId);

  const close = () => {
    setLineId("");
    setProblem(null);
    onClose();
  };

  const assign = async () => {
    const line = picked;
    // A second click can arrive before the re-render that disables the button.
    if (category === null || line === undefined || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setProblem(null);
    const result = await planWrite(
      api.PUT("/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories", {
        params: { path: { spaceId, planId: plan.id, lineId: line.id } },
        headers: ifMatch(plan),
        body: { categoryIds: [...line.categoryIds, category.id] },
      }),
    );
    if (result.ok) {
      inFlight.current = false;
      setPending(false);
      onAssigned(result.plan);
      close();
      return;
    }
    setProblem(result.problem);
    // A retry before the plan is read again would carry the same stale version, so the button waits for it.
    if (result.problem.code === "PreconditionFailed") {
      const fresh = await rereadPlan(api, spaceId, plan.id);
      if (fresh !== null) onPlan(fresh);
    }
    inFlight.current = false;
    setPending(false);
  };

  return (
    <Sheet
      open={category !== null}
      onOpenChange={(open) => {
        if (!open && !inFlight.current) close();
      }}
      title={t("planner.assignTitle", { category: category?.name ?? "" })}
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={pending || picked === undefined}
          onClick={() => void assign()}
        >
          {t("planner.assign")}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        {problem !== null ? <ProblemNotice problem={problem} /> : null}
        <p id={`${ids}-lines`} className="text-sm [overflow-wrap:anywhere] text-muted">
          {t("planner.assignHint")}
        </p>
        <RadioCard
          labelledBy={`${ids}-lines`}
          value={picked?.id ?? ""}
          options={lines.map((line) => ({
            value: line.id,
            label: line.name,
            description: `${formatMoney(line.plannedAmount, formats)} · ${t(`funding.${line.funding}`)}`,
          }))}
          onValueChange={setLineId}
        />
      </div>
    </Sheet>
  );
}

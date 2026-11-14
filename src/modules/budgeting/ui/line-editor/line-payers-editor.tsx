"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { Icon, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, PlanLineDto, SpaceDto, SpaceMemberDto } from "@/shared/ui/api/dto";
import type { Problem } from "@/shared/ui/api/problem";
import type { Formats } from "@/shared/ui/format/formatters";
import { periodName } from "@/shared/ui/time/period-name";
import { usePeriodWord } from "../period-word";
import { ifMatch, planWrite } from "../plan-write";
import { joinNames, namesOf, payerCandidates, type SheetChoice } from "./payers";

const PayerSheet = dynamic(() => import("./payer-sheet").then((module) => module.PayerSheet), { ssr: false });

/**
 * D26, P328: a payer of a line who does not manage the plan changes only that line's payers and their scope, from the
 * same row and sheet as the editor ("Ana y Juan también pueden cambiarlo desde el rubro"). Listo saves them at once.
 */
export function LinePayersEditor({
  space,
  plan,
  line,
  members,
  viewerMemberId,
  formats,
  api: injected,
}: {
  readonly space: SpaceDto;
  readonly plan: BudgetPlanDto;
  readonly line: PlanLineDto;
  readonly members: readonly SpaceMemberDto[];
  readonly viewerMemberId: string;
  readonly formats: Formats;
  readonly api?: Api;
}) {
  const t = useTranslations("budgeting.lineEditor.pay");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const periodWord = usePeriodWord();
  const [open, setOpen] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const payers = line.payerMemberIds ?? [];
  const scope = line.payersScope ?? "EVERY_PERIOD";
  const names = namesOf(payers, members);
  const monthly = periodName(plan.period, space.periodPolicy).kind === "month";
  const period = periodWord(plan.period, space.periodPolicy, formats);
  const save = async (choice: SheetChoice) => {
    if (pending) return;
    setProblem(null);
    setPending(true);
    const result = await planWrite(
      api.PATCH("/api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}", {
        params: { path: { spaceId: space.id, planId: plan.id, lineId: line.id } },
        headers: ifMatch(plan),
        body: {
          payerMemberIds: [...choice.payerMemberIds],
          ...(choice.payerMemberIds.length > 0 ? { payersScope: choice.payersScope } : {}),
        },
      }),
    );
    setPending(false);
    if (result.ok) router.refresh();
    else setProblem(result.problem);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        aria-haspopup="dialog"
        disabled={pending}
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center justify-between gap-3 border-b border-line py-2 text-left"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-base [overflow-wrap:anywhere] text-ink">
            {t("paidBy", { names: joinNames(names, t("and")), count: names.length })}
          </span>
          <span className="text-sm [overflow-wrap:anywhere] text-muted">
            {t("rowScope", { scope: t(`scopeRow.${scope}`, { period, monthly: String(monthly) }) })}
          </span>
        </span>
        <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
      </button>
      {problem ? <ProblemNotice problem={problem} /> : null}
      {open ? (
        <PayerSheet
          open={open}
          onOpenChange={setOpen}
          lineName={line.name}
          value={{ mode: "PAYERS", payerMemberIds: payers, payersScope: scope }}
          modes={["PAYERS"]}
          hasFund={line.funding === "SHARED_FUND"}
          candidates={payerCandidates(members)}
          viewerMemberId={viewerMemberId}
          period={period}
          monthly={monthly}
          shares={null}
          namesOf={(ids) => joinNames(namesOf(ids, members), t("and"))}
          onDone={(choice) => void save(choice)}
        />
      ) : null}
    </div>
  );
}

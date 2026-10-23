import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProblemNotice, ScreenHeader } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto, BudgetPlanDto, PlanLineDto } from "@/shared/ui/api/dto";
import { getMe, getSpaces, loaded, serverApi, type Loaded } from "@/shared/ui/api/server";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { canManage, isEditable } from "../plan-access";
import { LineEditor } from "./line-editor";

/**
 * HU-E9-08: the plan, the line being edited (`null` for a new one) and the caller's own savings accounts to offer
 * (ruling P213): active SAVINGS accounts of their personal space, in the plan's currency. The API attaches only
 * accounts the caller owns (P8), so the shared space's accounts are never read.
 */
export const loadLineEditor = async (
  api: Api,
  {
    spaceId,
    planId,
    lineId,
    personalSpaceId,
  }: { spaceId: string; planId: string; lineId: string | null; personalSpaceId: string },
): Promise<Loaded<{ plan: BudgetPlanDto; line: PlanLineDto | null; savingsAccounts: AccountDto[] }>> => {
  const [plan, accounts] = await Promise.all([
    loaded(api.GET("/api/v1/spaces/{spaceId}/plans/{planId}", { params: { path: { spaceId, planId } } })),
    loaded(api.GET("/api/v1/spaces/{spaceId}/accounts", { params: { path: { spaceId: personalSpaceId } } })),
  ]);
  if (!plan.ok) return plan;
  if (!accounts.ok) return accounts;
  const line = lineId === null ? null : (plan.data.lines.find((l) => l.id === lineId) ?? notFound());
  return {
    ok: true,
    data: {
      plan: plan.data,
      line,
      savingsAccounts: accounts.data.items.filter(
        (account) =>
          account.type === "SAVINGS" &&
          account.archivedAt === null &&
          account.balance.currency === plan.data.totalCapacity.currency,
      ),
    },
  };
};

/** Server: the editor of `lineId` (`null` adds a line) in `planId`, or a read-only note for whoever may not edit. */
export async function LineEditorContainer({
  spaceId,
  planId,
  lineId,
}: {
  readonly spaceId: string;
  readonly planId: string;
  readonly lineId: string | null;
}) {
  const [me, spaces] = await Promise.all([getMe(), getSpaces()]);
  const space = spaces.find((s) => s.id === spaceId) ?? notFound();
  const result = await loadLineEditor(await serverApi(), {
    spaceId,
    planId,
    lineId,
    personalSpaceId: personalSpaceOf(spaces).id,
  });
  if (!result.ok) return <ProblemNotice problem={result.problem} />;
  const { plan, line, savingsAccounts } = result.data;
  if (!canManage(space.role) || !isEditable(plan)) {
    const t = await getTranslations("budgeting.lineEditor");
    return (
      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4 py-4">
        <ScreenHeader
          backHref={`/spaces/${spaceId}/plans/${planId}`}
          title={line === null ? t("newTitle") : t("title", { name: line.name })}
        />
        <p className="text-base text-muted">{t("readOnly")}</p>
      </div>
    );
  }
  return (
    <LineEditor
      space={space}
      plan={plan}
      line={line}
      savingsAccounts={savingsAccounts}
      formats={me!.preferences.effective}
    />
  );
}

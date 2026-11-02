"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { categoryPath } from "@/modules/categories/ui";
import { controlsFor } from "@/modules/spaces/ui";
import { Button, Icon, ProblemNotice, ScreenHeader, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate, type Formats } from "@/shared/ui/format/formatters";
import { useToast } from "@/shared/ui/molecules/toast";
import { DateSheet } from "./date-sheet";
import type { RecurrenceDto } from "./recurrence-request";
import { partyOf, scheduleText, signedAmountOf, type RecurrenceNames } from "./recurrence-text";
import { RecurrenceBadges } from "./recurring-list";

export interface RecurrenceDetailProps extends RecurrenceNames {
  readonly space: SpaceDto;
  readonly recurrence: RecurrenceDto;
  /** `GET …/occurrences`: the next dates it will record, none while paused or ended. */
  readonly upcoming: readonly string[];
  readonly groups: readonly CategoryGroupDto[];
  readonly formats: Formats;
  readonly today: string;
  readonly api?: Api;
}

type Move = "pause" | "resume" | "end";
const DONE = { pause: "donePaused", resume: "doneResumed", end: "doneEnded" } as const;

/**
 * HU-E9-09, P270's detail: the amount and schedule, who pays, its dates and the next ones. "Pausar" and "Extender" side
 * by side, "Reanudar" in their place while paused, "Terminar" in the danger color behind a confirmation. Only an
 * ENDED recurrence takes `…/extend`; extending an active one moves its end date (PATCH). A VIEWER reads it all and
 * changes nothing (S6).
 */
export function RecurrenceDetail({
  space,
  recurrence,
  upcoming,
  groups,
  accountNames,
  memberNames,
  formats,
  today,
  api: injected,
}: RecurrenceDetailProps) {
  const t = useTranslations("recurrences");
  const ledger = useTranslations("ledger");
  const router = useRouter();
  const toast = useToast();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sheet, setSheet] = useState<"end" | "extend" | null>(null);
  const canManage = controlsFor(space.role, space.kind).recordMoney;
  const { status, description: name } = recurrence;
  const path = { spaceId: space.id, recurrenceId: recurrence.id };

  const settle = async (
    call: Promise<{ error?: unknown; response: Response }>,
    done: string,
  ): Promise<void> => {
    setPending(true);
    setProblem(null);
    try {
      const { error, response } = await call;
      if (response.ok) {
        toast.show({ message: done });
        router.refresh();
      } else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };
  const move = (to: Move) => {
    setSheet(null);
    const options = { params: { path } };
    void settle(
      to === "pause"
        ? api.POST("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/pause", options)
        : to === "resume"
          ? api.POST("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/resume", options)
          : api.POST("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/end", options),
      t(`detail.${DONE[to]}`, { name }),
    );
  };
  const extend = (endDate: string | null) =>
    void settle(
      status === "ENDED"
        ? api.POST("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}/extend", {
            params: { path },
            body: { endDate },
          })
        : api.PATCH("/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}", {
            params: { path },
            body: { endDate },
          }),
      t("detail.doneExtended", { name }),
    );

  const party = partyOf(
    recurrence,
    { accountNames, memberNames },
    { shared: space.kind !== "PERSONAL", transfer: (from, to) => ledger("transfer", { from, to }) },
  );
  const rows: [string, string][] = [];
  if (recurrence.type === "INCOME") rows.push([t("detail.receives"), party]);
  else if (recurrence.type === "TRANSFER") {
    rows.push([t("detail.from"), accountNames[recurrence.sourceAccountId ?? ""] ?? ""]);
    rows.push([t("detail.to"), accountNames[recurrence.destinationAccountId ?? ""] ?? ""]);
  } else rows.push([t("detail.from"), party]);
  if (recurrence.type === "FUND_CONTRIBUTION")
    rows.push([t("detail.to"), accountNames[recurrence.destinationAccountId ?? ""] ?? ""]);
  if (recurrence.categoryId)
    rows.push([t("detail.category"), categoryPath([...groups], recurrence.categoryId) ?? ""]);
  rows.push([
    recurrence.startDate <= today ? t("detail.started") : t("detail.starts"),
    formatDate(recurrence.startDate, formats),
  ]);
  rows.push([
    t("detail.ends"),
    recurrence.endDate ? formatDate(recurrence.endDate, formats) : t("detail.noEnd"),
  ]);
  const amount = signedAmountOf(recurrence, formats);
  const ended = status === "ENDED";

  return (
    <div className="mx-auto flex max-w-[560px] flex-col gap-4 py-3">
      <ScreenHeader
        backHref={`/spaces/${space.id}/recurrences`}
        title={name}
        subtitle={`${space.name} · ${t(`type.${recurrence.type}`)}`}
        action={
          canManage && !ended ? (
            <Link
              href={`/spaces/${space.id}/recurrences/${recurrence.id}/edit`}
              aria-label={t("detail.edit", { name })}
              className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink"
            >
              <Icon name="pencil" />
            </Link>
          ) : undefined
        }
      />
      <section className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-4">
        <p
          className={
            status === "ACTIVE"
              ? "text-[32px] leading-tight font-[650] whitespace-nowrap text-ink"
              : "text-[32px] leading-tight font-[650] whitespace-nowrap text-muted"
          }
        >
          {amount}
        </p>
        <p className="text-ink">{scheduleText(recurrence.schedule, t)}</p>
        <RecurrenceBadges recurrence={recurrence} />
      </section>
      <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map(([term, value]) => (
          <div key={term} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
            <dt className="text-sm text-muted">{term}</dt>
            <dd className="min-w-0 text-right font-medium break-words text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <section aria-labelledby="recurrence-next" className="flex flex-col gap-1">
        <h2 id="recurrence-next" className="text-sm font-semibold text-muted">
          {t("detail.next")}
        </h2>
        {status === "ACTIVE" && upcoming.length > 0 ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {upcoming.map((date) => (
              <li key={date} className="flex min-h-12 items-center justify-between gap-3 px-4 py-2">
                <span className="text-sm text-muted">{formatDate(date, formats)}</span>
                <span className="font-semibold whitespace-nowrap text-ink">{amount}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-start gap-2 rounded-2xl bg-track p-3 text-sm text-ink">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            {status === "PAUSED" ? t("detail.paused") : ended ? t("detail.ended") : t("detail.none")}
          </p>
        )}
      </section>
      {problem ? <ProblemNotice problem={problem} /> : null}
      {canManage ? (
        <div className="flex flex-col gap-3">
          {status === "ACTIVE" ? (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" size="md" disabled={pending} onClick={() => move("pause")}>
                {t("detail.pause")}
              </Button>
              <Button variant="secondary" size="md" disabled={pending} onClick={() => setSheet("extend")}>
                {t("detail.extend")}
              </Button>
            </div>
          ) : status === "PAUSED" ? (
            <Button size="lg" disabled={pending} onClick={() => move("resume")}>
              {t("detail.resume")}
            </Button>
          ) : (
            <Button size="lg" disabled={pending} onClick={() => setSheet("extend")}>
              {t("detail.extend")}
            </Button>
          )}
          {ended ? null : (
            <Button
              variant="dangerGhost"
              size="compact"
              className="self-start"
              disabled={pending}
              onClick={() => setSheet("end")}
            >
              {t("detail.end")}
            </Button>
          )}
        </div>
      ) : null}
      <Sheet
        open={sheet === "end"}
        onOpenChange={(open) => setSheet(open ? "end" : null)}
        title={t("detail.endTitle", { name })}
        footer={
          <div className="flex flex-col gap-3">
            <Button variant="danger" size="lg" onClick={() => move("end")}>
              {t("detail.endConfirm")}
            </Button>
            <Button variant="secondary" size="lg" onClick={() => setSheet(null)}>
              {t("detail.endKeep")}
            </Button>
          </div>
        }
      >
        <p className="text-ink">{t("detail.endBody")}</p>
      </Sheet>
      <DateSheet
        open={sheet === "extend"}
        onOpenChange={(open) => setSheet(open ? "extend" : null)}
        title={t("detail.extendTitle", { name })}
        value={recurrence.endDate}
        today={recurrence.endDate ?? today}
        formats={formats}
        onChoose={extend}
        noneLabel={t("detail.extendNoEnd")}
      />
    </div>
  );
}

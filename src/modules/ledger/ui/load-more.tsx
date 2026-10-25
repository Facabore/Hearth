"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, ProblemNotice } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { TransactionDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { formatDate } from "@/shared/ui/format/formatters";
import { groupByDay } from "./day-groups";
import { withTx } from "./detail/tx-href";
import { TransactionRow, type RowContext } from "./transaction-row";

/** HU-E9-03: the next 50 rows with the same query; a day continued from the page above keeps its heading there. */
export function LoadMore({
  spaceId,
  query,
  cursor,
  lastDate,
  today,
  context,
  listHref,
  api: injected,
}: {
  readonly spaceId: string;
  readonly query: {
    readonly period?: string;
    readonly categoryIds?: string;
    readonly payerMemberId?: string;
  };
  readonly cursor: string;
  readonly lastDate: string;
  readonly today: string;
  readonly context: RowContext;
  /** The list's own address: a row opens its detail there (ruling P189). */
  readonly listHref: string;
  /** For tests: the client to call; the browser's own by default. */
  readonly api?: Api;
}) {
  const t = useTranslations("ledger");
  const [rows, setRows] = useState<TransactionDto[]>([]);
  const [next, setNext] = useState<string | null>(cursor);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const more = async () => {
    if (!next) return;
    setPending(true);
    setProblem(null);
    try {
      const { data, error, response } = await (injected ?? browserApi()).GET(
        "/api/v1/spaces/{spaceId}/transactions",
        {
          params: { path: { spaceId }, query: { ...query, limit: 50, cursor: next } },
        },
      );
      if (data) {
        setRows((all) => [...all, ...data.items]);
        setNext(data.nextCursor);
      } else setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };
  return (
    <>
      {groupByDay(rows, today).map((group, index) => (
        <section key={`${group.date}-${index}`} aria-label={formatDate(group.date, context.formats)}>
          {index === 0 && group.date === lastDate ? null : (
            <h2 className="mb-1 text-sm font-semibold text-muted">
              {group.relative ? t(`day.${group.relative}`) : formatDate(group.date, context.formats)}
            </h2>
          )}
          <ol className="divide-y divide-line rounded-2xl bg-surface px-4">
            {group.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} context={context} href={withTx(listHref, tx.id)} />
            ))}
          </ol>
        </section>
      ))}
      {problem ? <ProblemNotice problem={problem} /> : null}
      {next ? (
        <Button variant="secondary" disabled={pending} onClick={() => void more()}>
          {t("list.loadMore")}
        </Button>
      ) : null}
    </>
  );
}

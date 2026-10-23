"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Badge, Icon } from "@/shared/ui";
import type { MoneyDto } from "@/shared/ui/api/dto";
import { formatMoney, formatPercent, type Formats } from "@/shared/ui/format/formatters";
import { DrillBreadcrumb } from "./drill-breadcrumb";
import { NodeLabel, useNodeText } from "./node-label";
import { levelAt, type SpendingNode } from "./spending-tree";

/** The query parameter that holds the path of node ids, one per level; ruling P215 keeps the levels on the client. */
const DRILL = "drill";
const HINTS = ["groups", "categories", "subcategories"] as const;

/**
 * HU-E9-10 (the ByGroup artboard, rulings P202 and P215): one level of the spending tree as rows, each with its name,
 * its amount and share as the API answered them and a bar of that share, so the chart and the table are one element.
 * A row with something under it is a button that goes one level down; the breadcrumb goes back up.
 *
 * Each level is a URL (`?drill=<id>&drill=<id>`), changed with the browser's own `pushState`, which Next syncs with
 * `useSearchParams` without a request: the browser's Back, Volver and a reload all return to the level the person
 * was on.
 */
export function SpendingChart({
  tree,
  total,
  formats,
  note,
}: {
  readonly tree: readonly SpendingNode[];
  readonly total: MoneyDto;
  readonly formats: Pick<Formats, "numberFormat">;
  readonly note: string;
}) {
  const t = useTranslations("reports.byGroup");
  const nodeText = useNodeText();
  const params = useSearchParams();
  const { node, rows, trail } = levelAt(tree, params.getAll(DRILL));
  const ids = trail.map((n) => n.id);
  const go = (path: readonly string[]) => {
    const url = new URL(window.location.href);
    url.searchParams.delete(DRILL);
    for (const id of path) url.searchParams.append(DRILL, id);
    window.history.pushState(null, "", `${url.pathname}${url.search}`);
  };

  // A button that opens a level disappears with it: the focus moves to the new level's total, not to the page.
  const heading = useRef<HTMLParagraphElement>(null);
  const level = useRef(ids.join("/"));
  useEffect(() => {
    if (level.current === ids.join("/")) return;
    level.current = ids.join("/");
    heading.current?.focus();
  });

  const label =
    trail.length === 0
      ? t("groups")
      : trail.length === 1
        ? t("categoriesOf", { name: nodeText(node!.name) })
        : t("subcategoriesOf", { name: nodeText(node!.name) });
  return (
    <>
      <DrillBreadcrumb trail={trail} onGo={(kept) => go(ids.slice(0, kept))} />
      <p ref={heading} tabIndex={-1} className="flex flex-col gap-0.5 tabular-nums">
        <span className="text-sm text-muted">
          {node ? t("totalOf", { name: nodeText(node.name) }) : t("total")}
        </span>
        <span className="text-3xl font-semibold [overflow-wrap:anywhere]">
          {formatMoney(node?.total ?? total, formats)}
        </span>
      </p>
      <p className="text-sm text-muted">{t(`hint.${HINTS[Math.min(trail.length, HINTS.length - 1)]!}`)}</p>
      <ul aria-label={label} className="overflow-hidden rounded-2xl border border-line bg-surface">
        {rows.map((row) => {
          const opens = row.children.length > 0;
          const content = (
            <>
              <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 tabular-nums">
                <span className="flex min-w-0 flex-[1_1_8rem] flex-wrap items-center gap-x-2 gap-y-1">
                  <span data-cell className="text-base font-semibold [overflow-wrap:anywhere]">
                    <NodeLabel name={row.name} />
                  </span>
                  {row.archived ? <Badge>{t("archived")}</Badge> : null}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  <span data-cell className="text-base font-semibold">
                    {formatMoney(row.total, formats)}
                  </span>
                  <span data-cell className="w-16 text-right text-sm">
                    {formatPercent(row.share, formats)}
                  </span>
                  {opens ? <Icon name="chevronRight" size={16} /> : <span className="w-4" />}
                </span>
              </span>
              <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-track">
                <span
                  data-bar
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${Number(row.share)}%` }}
                />
              </span>
            </>
          );
          return (
            <li key={row.id} className="border-b border-line last:border-b-0">
              {opens ? (
                <button
                  type="button"
                  onClick={() => go([...ids, row.id])}
                  className="flex min-h-[68px] w-full flex-col gap-2 px-3.5 py-3 text-left"
                >
                  {content}
                </button>
              ) : (
                <div className="flex min-h-[68px] flex-col gap-2 px-3.5 py-3">{content}</div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">{note}</p>
    </>
  );
}

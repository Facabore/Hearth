"use client";

import { useTranslations } from "next-intl";
import { NodeLabel } from "./node-label";
import type { SpendingNode } from "./spending-tree";

// The separator is CSS, so the breadcrumb's text holds the names only. Every crumb is a 44 px target.
const ITEM =
  "flex items-center before:px-0.5 before:text-muted before:content-['›'] first:before:content-none";
const CRUMB = "flex min-h-11 items-center px-1.5 text-[15px] font-semibold [overflow-wrap:anywhere]";

/**
 * The ByGroup artboard's "Ruta" (HU-E9-10, ruling P215): "Todos los grupos" and each level above the current one are
 * buttons that go up (`onGo(n)` keeps the first n levels of the trail), and the current level is plain text marked
 * `aria-current="location"`.
 */
export function DrillBreadcrumb({
  trail,
  onGo,
}: {
  readonly trail: readonly SpendingNode[];
  readonly onGo: (kept: number) => void;
}) {
  const t = useTranslations("reports.byGroup");
  const button = "underline underline-offset-4 text-accent";
  return (
    <nav aria-label={t("trail")}>
      <ol className="flex flex-wrap items-center">
        <li className={ITEM}>
          {trail.length === 0 ? (
            <span aria-current="location" className={CRUMB}>
              {t("all")}
            </span>
          ) : (
            <button type="button" onClick={() => onGo(0)} className={`${CRUMB} ${button}`}>
              {t("all")}
            </button>
          )}
        </li>
        {trail.map((node, index) => (
          <li key={node.id} className={ITEM}>
            {index === trail.length - 1 ? (
              <span aria-current="location" className={CRUMB}>
                <NodeLabel name={node.name} />
              </span>
            ) : (
              <button type="button" onClick={() => onGo(index + 1)} className={`${CRUMB} ${button}`}>
                <NodeLabel name={node.name} />
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

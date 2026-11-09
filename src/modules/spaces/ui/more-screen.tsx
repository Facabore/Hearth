"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Icon, SymbolIcon } from "@/shared/ui";

const TILE =
  "flex aspect-square min-h-11 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-surface p-2 text-center text-sm font-medium [overflow-wrap:anywhere]";

/**
 * Ruling P311 (board "Más · módulos · P311"): the bar's Más, where the app's modules live as a grid of square tiles in
 * three columns. The live ones open the active space's Configuración, Cuentas, Categorías and Recurrentes; the
 * modules still to come (Estadísticas #277, Calendario #278, Exportar e importar #279) say "Próximamente" and open
 * nothing. The person's own settings stay in her profile, as the note under the grid says. Ruling P314 (#284, audit
 * pass 3 A4): "Planea tu mes" leads the grid and opens the space's Plan, which otherwise has only Configuración's row.
 */
export function MoreScreen({ spaceId }: { readonly spaceId: string }) {
  const t = useTranslations("shell.more");
  const base = `/spaces/${spaceId}`;
  const live = (href: string, icon: ReactNode, label: string) => (
    <li key={href}>
      <Link href={href} className={`${TILE} text-ink`}>
        {icon}
        {label}
      </Link>
    </li>
  );
  const soon = (icon: ReactNode, label: string) => (
    <li key={label}>
      <div className={`${TILE} text-muted`}>
        {icon}
        <span>{label}</span>
        <span className="text-xs font-normal">{t("soon")}</span>
      </div>
    </li>
  );
  return (
    <div className="mx-auto flex max-w-[640px] flex-col gap-4 py-3">
      <h1 className="text-[22px] font-semibold text-ink">{t("title")}</h1>
      <ul className="grid grid-cols-3 gap-3">
        {live(`${base}/plan`, <Icon name="chart" />, t("plan"))}
        {live(`${base}/settings`, <Icon name="sliders" />, t("settings"))}
        {live(`${base}/accounts`, <SymbolIcon name="wallet" />, t("accounts"))}
        {live(`${base}/categories`, <SymbolIcon name="tag" />, t("categories"))}
        {live(`${base}/recurrences`, <SymbolIcon name="receipt" />, t("recurring"))}
        {soon(<SymbolIcon name="trend" />, t("stats"))}
        {soon(<Icon name="calendar" />, t("calendar"))}
        {soon(<Icon name="archive" />, t("exportImport"))}
      </ul>
      <p className="text-sm text-muted">{t("note")}</p>
    </div>
  );
}

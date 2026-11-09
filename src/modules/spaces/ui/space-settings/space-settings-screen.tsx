"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useId, useMemo, useState, type ReactNode } from "react";
import { Icon, ScreenHeader, SymbolIcon } from "@/shared/ui";
import { SpaceChip } from "@/shared/ui/atoms/space-chip";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { LazySpaceNameSection } from "../lazy-space-name-section";
import { controlsFor } from "../members/space-controls";
import type { SpaceSummary } from "../space-helpers";
import { lifecycleFor } from "./lifecycle-controls";
import { loadSpaceLifecycleSheet, type LifecycleSheet } from "./lazy-space-lifecycle-sheet";
import type { SpaceLifecycle } from "./space-lifecycle-sheet";

/** What a row of the list says on its right, as the app reads it; nothing while it has not. */
export interface SpaceSettingsStatus {
  /** "Quedan $ 380.000" or "Sin plan": the period's plan. */
  readonly plan?: ReactNode;
  /** "4 personas": the space's current members. */
  readonly members?: ReactNode;
  /** "2 por confirmar": the space's pending occurrences, counted as the Movimientos badge counts them. */
  readonly recurring?: ReactNode;
}

const ROW = "flex min-h-14 w-full items-center gap-3 py-2 text-left";

/**
 * Ruling P311 (boards "Configuración de Hogar · plana, con cambio de espacio", "Configuración de Personal" and
 * "Configuración · elegir espacio (desplegable abierto)", amending P309): a space's own Configuración, opened from the
 * header's ⚙. Under its title a plain text dropdown names the space and switches which of the person's spaces it
 * configures; then one flat list under small section titles: the period's plan, the people (shared and direct spaces),
 * the money (accounts, categories, recurring movements) and the space itself (its name and color, leaving and
 * archiving it). Roles are the permission matrix's, as `controlsFor` and `lifecycleFor` copy it.
 */
export function SpaceSettingsScreen({
  space,
  spaces,
  people = {},
  status = {},
  homeHref,
  api: injected,
}: {
  readonly space: SpaceDto;
  /** The person's current spaces, which the dropdown offers. */
  readonly spaces: readonly SpaceSummary[];
  /** How many people each shared or direct space has, by its id, once the app has read them. */
  readonly people?: Readonly<Record<string, number>>;
  readonly status?: SpaceSettingsStatus;
  /** Where the person lands once the space is left or archived: the personal space's home. */
  readonly homeHref: string;
  readonly api?: Api;
}) {
  const t = useTranslations("spaces.screen");
  const switcher = useTranslations("shell.space");
  const names = useTranslations("members");
  const settings = useTranslations("spaces.settings");
  const common = useTranslations("common");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [opening, setOpening] = useState<SpaceLifecycle | null>(null);
  const [sheet, setSheet] = useState<{
    readonly action: SpaceLifecycle;
    readonly Sheet: LifecycleSheet;
  } | null>(null);
  const [picking, setPicking] = useState(false);
  const [naming, setNaming] = useState(false);
  const menuId = useId();
  const nameId = useId();
  const controls = { ...controlsFor(space.role, space.kind), ...lifecycleFor(space.role, space.kind) };
  const values = { space: space.name };
  const policy =
    space.periodPolicy.kind === "MONTHLY"
      ? names("policy.MONTHLY", { day: space.periodPolicy.day })
      : names("policy.SEMI_MONTHLY", { day1: space.periodPolicy.day1, day2: space.periodPolicy.day2 });
  const base = `/spaces/${space.id}`;
  const personal = space.kind === "PERSONAL";
  const kindOf = (other: SpaceSummary) => {
    const count = people[other.id];
    if (other.kind === "PERSONAL") return switcher("onlyYou");
    return count === undefined
      ? t(`kind.${other.kind}`)
      : t("withPeople", { kind: t(`kind.${other.kind}`), count });
  };

  const row = (href: string, icon: ReactNode, label: string, aside?: ReactNode) => (
    <li>
      <Link href={href} className={`${ROW} text-ink`}>
        {icon}
        <span data-row-label className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {label}
        </span>
        {aside ? <span className="shrink-0 text-sm text-muted">{aside}</span> : null}
        <Icon name="chevronRight" size={20} className="shrink-0 text-muted" />
      </Link>
    </li>
  );
  const section = (key: "plan" | "people" | "money" | "space", rows: ReactNode) => (
    <>
      <h2 className="pt-4 text-sm font-semibold text-muted">{t(`section.${key}`)}</h2>
      <ul className="flex flex-col divide-y divide-line">{rows}</ul>
    </>
  );
  // The sheet's code loads on the press; until it is here the row says so, and a failed load waits for another tap.
  const ask = (action: SpaceLifecycle) => {
    setOpening(action);
    loadSpaceLifecycleSheet().then(
      (Sheet) => {
        setOpening(null);
        setSheet({ action, Sheet });
      },
      () => setOpening(null),
    );
  };
  const danger = (action: SpaceLifecycle, icon: ReactNode) => (
    <li>
      <button
        type="button"
        aria-busy={opening === action || undefined}
        className={`${ROW} text-danger`}
        onPointerDown={() => void loadSpaceLifecycleSheet().catch(() => undefined)}
        onClick={() => ask(action)}
      >
        {icon}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-medium [overflow-wrap:anywhere]">{t(action, values)}</span>
          <span className="text-sm text-muted">
            {opening === action ? common("loading") : t(`${action}Hint`, values)}
          </span>
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-1 pb-3">
      <ScreenHeader backHref={base} title={t("title")} />
      <div
        className="relative flex flex-col items-start"
        onKeyDown={(event) => {
          if (event.key === "Escape") setPicking(false);
        }}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPicking(false);
        }}
      >
        {/* Board "Configuración · elegir espacio": a plain text dropdown, no pill and no circle (owner, L10). */}
        <button
          type="button"
          aria-expanded={picking}
          aria-controls={menuId}
          onClick={() => setPicking((open) => !open)}
          className="flex min-h-11 max-w-full items-center gap-1 text-lg font-semibold text-accent"
        >
          <span className="truncate">{space.name}</span>
          <Icon name="chevronDown" size={20} className="shrink-0" />
        </button>
        {picking ? (
          <ul
            id={menuId}
            aria-label={switcher("title")}
            className="absolute top-full left-0 z-20 flex w-80 max-w-[calc(100vw-2rem)] flex-col rounded-2xl bg-surface p-1 shadow-lg ring-1 ring-line"
          >
            {spaces.map((other) => {
              const current = other.id === space.id;
              return (
                <li key={other.id}>
                  <Link
                    href={`/spaces/${other.id}/settings`}
                    aria-current={current ? "true" : undefined}
                    onClick={() => setPicking(false)}
                    className="flex min-h-14 items-center gap-3 rounded-xl px-3 py-2 text-ink"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold [overflow-wrap:anywhere]">{other.name}</span>
                      <span className="text-sm text-muted">{kindOf(other)}</span>
                    </span>
                    {current ? <Icon name="check" size={22} className="shrink-0 text-accent" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="text-sm text-muted">
          {t("subtitle", { kind: t(`kind.${space.kind}`), currency: space.currency, policy })}
        </p>
      </div>
      <nav aria-label={t("title")} className="flex flex-col">
        {section("plan", row(`${base}/plan`, <Icon name="chart" />, t("plan"), status.plan))}
        {personal
          ? null
          : section("people", row(`${base}/members`, <Icon name="userPlus" />, t("members"), status.members))}
        {section(
          "money",
          <>
            {row(
              `${base}/accounts`,
              <Icon name="list" />,
              t(space.kind === "SHARED" ? "accountsAndFunds" : "accounts"),
            )}
            {row(`${base}/categories`, <SymbolIcon name="tag" />, t("categories"))}
            {row(`${base}/recurrences`, <SymbolIcon name="receipt" />, t("recurring"), status.recurring)}
          </>,
        )}
        {section(
          "space",
          <>
            <li>
              <button
                type="button"
                aria-expanded={naming}
                aria-controls={nameId}
                onClick={() => setNaming((open) => !open)}
                className={`${ROW} text-ink`}
              >
                <Icon name="pencil" />
                <span className="flex-1">{personal ? t("name") : settings("nameAndColor")}</span>
                <Icon
                  name={naming ? "chevronDown" : "chevronRight"}
                  size={20}
                  className="shrink-0 text-muted"
                />
              </button>
              {naming ? (
                <div id={nameId} className="pb-3">
                  {controls.rename ? (
                    // Keyed by the space: another space starts the field afresh, its own rename's refresh does not.
                    <LazySpaceNameSection key={space.id} space={space} />
                  ) : (
                    <div className="flex flex-col gap-3">
                      {space.color ? (
                        <span>
                          <SpaceChip name={space.name} color={space.color} />
                        </span>
                      ) : null}
                      <p className="text-sm text-muted">{t("readOnly", values)}</p>
                    </div>
                  )}
                </div>
              ) : null}
            </li>
            {controls.leave ? danger("leave", <Icon name="signOut" />) : null}
            {controls.archive ? danger("archive", <Icon name="archive" />) : null}
          </>,
        )}
      </nav>
      {sheet ? (
        <sheet.Sheet
          action={sheet.action}
          space={space}
          api={api}
          open
          onOpenChange={(open) => {
            if (!open) setSheet(null);
          }}
          onDone={() => {
            setSheet(null);
            router.replace(homeHref);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

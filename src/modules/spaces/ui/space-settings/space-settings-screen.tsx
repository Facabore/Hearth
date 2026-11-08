"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";
import { Button, Icon, ScreenHeader, SymbolIcon } from "@/shared/ui";
import { SpaceChip } from "@/shared/ui/atoms/space-chip";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { LazySpaceNameSection } from "../lazy-space-name-section";
import { controlsFor } from "../members/space-controls";
import { lifecycleFor } from "./lifecycle-controls";
import { SpaceLifecycleSheet, type SpaceLifecycle } from "./space-lifecycle-sheet";

/**
 * Ruling P309 (boards "Ajustes de Hogar · Propietario", "… · Miembro o Lector" and "Ajustes de Personal"): a space's own
 * settings, reached from the space switcher, where they used to hide in the profile sheet and the app's Settings
 * (owner, 2026-11-07). Its screens (members and guests, categories, accounts and funds), its name and color for an
 * OWNER or ADMIN, and leaving or archiving it. Roles are the permission matrix's, as `controlsFor` copies it.
 */
export function SpaceSettingsScreen({
  space,
  homeHref,
  api: injected,
}: {
  readonly space: SpaceDto;
  /** Where the person lands once the space is left or archived: the personal space's home. */
  readonly homeHref: string;
  readonly api?: Api;
}) {
  const t = useTranslations("spaces.screen");
  const names = useTranslations("members");
  const settings = useTranslations("spaces.settings");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [sheet, setSheet] = useState<SpaceLifecycle | null>(null);
  const controls = { ...controlsFor(space.role, space.kind), ...lifecycleFor(space.role, space.kind) };
  const values = { space: space.name };
  const policy =
    space.periodPolicy.kind === "MONTHLY"
      ? names("policy.MONTHLY", { day: space.periodPolicy.day })
      : names("policy.SEMI_MONTHLY", { day1: space.periodPolicy.day1, day2: space.periodPolicy.day2 });
  const base = `/spaces/${space.id}`;

  const row = (href: string, icon: ReactNode, label: string) => (
    <Link href={href} className="flex min-h-14 items-center gap-3 px-3 py-2 text-ink">
      {icon}
      <span className="flex-1">{label}</span>
      <Icon name="chevronRight" size={20} />
    </Link>
  );
  const danger = (action: SpaceLifecycle, icon: ReactNode) => (
    <div className="flex flex-col gap-2">
      <Button variant="danger" size="lg" className="w-full" onClick={() => setSheet(action)}>
        {icon}
        {t(action, values)}
      </Button>
      <p className="text-sm text-muted">{t(`${action}Hint`, values)}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-3">
      <ScreenHeader
        backHref={base}
        title={t("title", values)}
        subtitle={t("subtitle", { kind: t(`kind.${space.kind}`), currency: space.currency, policy })}
      />
      <nav
        aria-label={t("title", values)}
        className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface"
      >
        {space.kind === "PERSONAL" ? null : row(`${base}/members`, <Icon name="userPlus" />, t("members"))}
        {row(`${base}/categories`, <SymbolIcon name="tag" />, t("categories"))}
        {row(
          `${base}/accounts`,
          <Icon name="list" />,
          t(space.kind === "SHARED" ? "accountsAndFunds" : "accounts"),
        )}
      </nav>
      {controls.rename ? (
        // Keyed by the space: another space starts the field afresh, its own rename's refresh does not.
        <LazySpaceNameSection key={space.id} space={space} />
      ) : (
        <section aria-labelledby="space-name-read" className="flex flex-col gap-3">
          <h2 id="space-name-read" className="text-lg font-semibold text-ink">
            {settings("nameAndColor")}
          </h2>
          {space.color ? (
            <span>
              <SpaceChip name={space.name} color={space.color} />
            </span>
          ) : null}
          <p className="text-sm text-muted">{t("readOnly", values)}</p>
        </section>
      )}
      {controls.leave || controls.archive ? (
        <div className="flex flex-col gap-3">
          {controls.leave ? danger("leave", <Icon name="signOut" />) : null}
          {controls.archive ? danger("archive", null) : null}
        </div>
      ) : null}
      {sheet ? (
        <SpaceLifecycleSheet
          action={sheet}
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

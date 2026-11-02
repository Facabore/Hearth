"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense, useState, type ComponentType } from "react";
import { Button, Icon, Sheet } from "@/shared/ui";
import type { Formats } from "@/shared/ui/format/formatters";
import type { SpaceSummary } from "./space-helpers";
import type { MyBalanceDto, SpaceStandingView } from "./space-standing";

/** The flows the switcher opens over itself: "create" is `NewSpaceForm`, "join" is `JoinByLinkForm`. */
export type SpaceFlow = "create" | "join";

/**
 * The component that draws a flow inside the switcher's sheet; `onDone` closes the sheet. The app passes it in, loaded
 * on demand with a screen it already splits (the switcher sits in every tab's shell, P134).
 */
export type SpaceFlows = ComponentType<{ readonly flow: SpaceFlow; readonly onDone: () => void }>;

/** The actions under the spaces, each with its round grey icon; the sheet's title while one is open. */
const ACTIONS = [
  { flow: "create", icon: "plus", title: "spaces.new.title" },
  { flow: "join", icon: "link", title: "spaces.join.title" },
] as const;

/** A space's initial in its round tint: the personal space green, a shared one terracotta (boards B1 · 03 and 04). */
function SpaceInitial({ space, size }: { readonly space: SpaceSummary; readonly size: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${space.kind === "PERSONAL" ? "bg-accent-soft text-accent" : "bg-owe-soft text-owe-ink"}`}
    >
      {space.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * HU-E9-01, the SpaceSheet artboard: every current space as a link, then, under a divider, the boards' two ways to
 * another space (HU-E9-05): "Crear un espacio compartido" and "Unirme con un enlace de invitación", 56 px targets.
 * Each opens in the same sheet, over the switcher, with a way back to the spaces (ruling P272).
 */
export function SpaceSwitcher({
  spaces,
  activeSpace,
  flows: Flows,
  personId,
  formats,
  balances,
  standing: Standing,
  onOpen,
}: {
  readonly spaces: readonly SpaceSummary[];
  readonly activeSpace: SpaceSummary;
  readonly flows?: SpaceFlows | undefined;
  readonly personId: string;
  readonly formats?: Pick<Formats, "numberFormat"> | undefined;
  /** Ruling P277: the person's standing in each shared space, once read (the app reads it when the sheet opens). */
  readonly balances?: readonly MyBalanceDto[] | undefined;
  /** The card text of a shared space with its standing, loaded on demand by the app. */
  readonly standing?: SpaceStandingView | undefined;
  readonly onOpen?: (() => void) | undefined;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [flow, setFlow] = useState<SpaceFlow | null>(null);
  const close = () => setOpen(false);
  const opened = ACTIONS.find((action) => action.flow === flow);
  return (
    <>
      <button
        type="button"
        aria-label={t("shell.space.current", { name: activeSpace.name })}
        onClick={() => {
          setFlow(null);
          setOpen(true);
          onOpen?.();
        }}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-3 pl-1 text-lg font-semibold text-ink"
      >
        <SpaceInitial space={activeSpace} size={30} />
        {/* A long name truncates instead of widening the header (WCAG 1.4.10); the full name is in the aria-label. */}
        <span className="truncate">{activeSpace.name}</span>
        <Icon name="chevronDown" size={20} className="shrink-0" />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t(opened ? opened.title : "shell.space.title")}>
        {opened && Flows ? (
          <div className="flex flex-col gap-2">
            {/* The board's back chevron: to the spaces, inside the same sheet. */}
            <Button size="icon" variant="ghost" aria-label={t("common.back")} onClick={() => setFlow(null)}>
              <Icon name="back" />
            </Button>
            <Suspense fallback={null}>
              <Flows flow={opened.flow} onDone={close} />
            </Suspense>
          </div>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {spaces.map((space) => {
                const current = space.id === activeSpace.id;
                const balance = balances?.find((b) => b.spaceId === space.id);
                const plain = (
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold [overflow-wrap:anywhere] text-ink">{space.name}</span>
                    {space.kind === "PERSONAL" ? (
                      <span className="text-sm text-muted">{t("shell.space.onlyYou")}</span>
                    ) : null}
                  </span>
                );
                return (
                  <li key={space.id}>
                    {/* Board B1 · 04: each space is a card; the current one has a green border, a tint and a check. */}
                    <Link
                      href={`/spaces/${space.id}`}
                      aria-current={current ? "true" : undefined}
                      onClick={close}
                      className={`flex min-h-[72px] items-center gap-3 rounded-2xl border px-3 py-2 ${current ? "border-accent bg-accent-soft/40" : "border-line"}`}
                    >
                      <SpaceInitial space={space} size={44} />
                      {Standing && balance ? (
                        <Suspense fallback={plain}>
                          <Standing
                            name={space.name}
                            balance={balance}
                            personId={personId}
                            formats={formats}
                          />
                        </Suspense>
                      ) : (
                        plain
                      )}
                      {current ? <Icon name="check" size={22} className="shrink-0 text-accent" /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {Flows ? (
              <>
                <hr className="my-3 border-line" />
                {ACTIONS.map((action) => (
                  <button
                    key={action.flow}
                    type="button"
                    onClick={() => setFlow(action.flow)}
                    className="flex min-h-14 w-full items-center gap-3 rounded-xl px-1 text-left font-medium text-ink"
                  >
                    <span
                      aria-hidden="true"
                      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-track"
                    >
                      <Icon name={action.icon} size={20} />
                    </span>
                    {t(`shell.space.${action.flow}`)}
                  </button>
                ))}
              </>
            ) : null}
          </>
        )}
      </Sheet>
    </>
  );
}

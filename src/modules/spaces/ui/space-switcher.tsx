"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Suspense, useState, type ComponentType } from "react";
import { Avatar, Button, Icon, Sheet } from "@/shared/ui";
import type { SpaceSummary } from "./space-helpers";

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

/**
 * HU-E9-01, the SpaceSheet artboard: every current space as a link, then, under a divider, the boards' two ways to
 * another space (HU-E9-05): "Crear un espacio compartido" and "Unirme con un enlace de invitación", 56 px targets.
 * Each opens in the same sheet, over the switcher, with a way back to the spaces (ruling P272).
 */
export function SpaceSwitcher({
  spaces,
  activeSpace,
  flows: Flows,
}: {
  readonly spaces: readonly SpaceSummary[];
  readonly activeSpace: SpaceSummary;
  readonly flows?: SpaceFlows | undefined;
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
        }}
        className="flex min-h-11 min-w-0 items-center gap-2 rounded-xl px-2 text-lg font-semibold text-ink"
      >
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
            <ul className="flex flex-col gap-1">
              {spaces.map((space) => (
                <li key={space.id}>
                  <Link
                    href={`/spaces/${space.id}`}
                    aria-current={space.id === activeSpace.id ? "true" : undefined}
                    onClick={close}
                    className="flex min-h-14 items-center gap-3 rounded-xl px-2 aria-[current=true]:bg-accent-soft"
                  >
                    <Avatar name={space.name} />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium text-ink [overflow-wrap:anywhere]">{space.name}</span>
                      <span className="text-sm text-muted">
                        {space.kind === "PERSONAL"
                          ? t("shell.space.onlyYou")
                          : space.role
                            ? t(`shell.role.${space.role}`)
                            : null}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {Flows ? (
              <>
                <hr className="my-2 border-line" />
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

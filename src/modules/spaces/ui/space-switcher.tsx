"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Avatar, Icon, Sheet } from "@/shared/ui";
import type { SpaceSummary } from "./space-helpers";

/** HU-E9-01, the SpaceSheet artboard: every current space as a link, then create a shared space (HU-E9-05, P160). */
export function SpaceSwitcher({
  spaces,
  activeSpace,
}: {
  readonly spaces: readonly SpaceSummary[];
  readonly activeSpace: SpaceSummary;
}) {
  const t = useTranslations("shell");
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label={t("space.current", { name: activeSpace.name })}
        onClick={() => setOpen(true)}
        className="flex min-h-11 items-center gap-2 rounded-xl px-2 text-lg font-semibold text-ink"
      >
        {activeSpace.name}
        <Icon name="chevronDown" size={20} />
      </button>
      <Sheet open={open} onOpenChange={setOpen} title={t("space.title")}>
        <ul className="flex flex-col gap-1">
          {spaces.map((space) => (
            <li key={space.id}>
              <Link
                href={`/spaces/${space.id}`}
                aria-current={space.id === activeSpace.id ? "true" : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-14 items-center gap-3 rounded-xl px-2 aria-[current=true]:bg-accent-soft"
              >
                <Avatar name={space.name} />
                <span className="flex flex-col">
                  <span className="font-medium text-ink">{space.name}</span>
                  <span className="text-sm text-muted">
                    {space.kind === "PERSONAL"
                      ? t("space.onlyYou")
                      : space.role
                        ? t(`role.${space.role}`)
                        : null}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <Link
          href="/spaces/new"
          onClick={() => setOpen(false)}
          className="mt-2 flex min-h-14 items-center gap-3 rounded-xl px-2 font-medium text-accent"
        >
          <Icon name="plus" />
          {t("space.create")}
        </Link>
      </Sheet>
    </>
  );
}

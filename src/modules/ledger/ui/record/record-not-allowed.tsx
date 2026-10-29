"use client";

import { useTranslations } from "next-intl";
import { ScreenHeader } from "@/shared/ui";
import type { SpaceDto } from "@/shared/ui/api/dto";

/**
 * Issue #207: the record form's place for someone who cannot record in the space (a VIEWER). It names her role before
 * she types anything, instead of a form whose save the API refuses.
 */
export function RecordNotAllowed({
  space,
  backHref,
}: {
  readonly space: Pick<SpaceDto, "name" | "role">;
  readonly backHref: string;
}) {
  const t = useTranslations("ledger.form");
  const roles = useTranslations("shell.role");
  return (
    <div className="flex flex-col gap-3 py-3">
      <ScreenHeader backHref={backHref} title={t("title")} />
      <p className="rounded-2xl bg-track p-3 text-sm text-ink">
        {t("readOnly", { space: space.name, role: space.role ? roles(space.role) : "" })}
      </p>
    </div>
  );
}

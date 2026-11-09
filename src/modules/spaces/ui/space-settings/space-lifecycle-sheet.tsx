"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Sheet } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { useProblemMessage } from "@/shared/ui/api/use-problem-message";

export type SpaceLifecycle = "leave" | "archive";

/**
 * Ruling P309 (boards "¿Salir de Hogar?" and "¿Archivar Hogar?"): leaving or archiving a space asks first. The API
 * stays the authority (HU-E1-08, HU-E1-09): a refusal, such as a balance that is not zero, stays in the sheet.
 */
export function SpaceLifecycleSheet({
  action,
  space,
  api,
  open,
  onOpenChange,
  onDone,
}: {
  readonly action: SpaceLifecycle;
  readonly space: Pick<SpaceDto, "id" | "name">;
  readonly api: Api;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The space is left or archived: the app leaves its screens. */
  readonly onDone: () => void;
}) {
  const t = useTranslations("spaces.screen");
  const messageOf = useProblemMessage();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const values = { space: space.name };

  const confirm = async () => {
    setPending(true);
    setProblem(null);
    try {
      const params = { params: { path: { spaceId: space.id } } };
      const { error, response } =
        action === "leave"
          ? await api.POST("/api/v1/spaces/{spaceId}/leave", params)
          : await api.POST("/api/v1/spaces/{spaceId}/archive", params);
      if (response.ok) {
        onDone();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setProblem(null);
        onOpenChange(next);
      }}
      title={t(`${action}Sheet.title`, values)}
      description={t(`${action}Sheet.body`, values)}
      footer={
        <div className="flex flex-col gap-2">
          <Button variant="danger" size="lg" disabled={pending} onClick={() => void confirm()}>
            {t(action, values)}
          </Button>
          <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
        </div>
      }
    >
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {messageOf(problem).message}
        </p>
      ) : null}
    </Sheet>
  );
}

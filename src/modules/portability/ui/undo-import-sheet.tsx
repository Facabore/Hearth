"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button, Sheet } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { RefusalNotice, useCall } from "./parts";

/**
 * D28, design §3.2: undoing a confirmed import, behind its confirmation. It deletes logically what the import brought
 * and archives what it created that nothing else uses; `onUndone` runs once the API answered.
 */
export function UndoImportSheet({
  open,
  onOpenChange,
  spaceId,
  importId,
  onUndone,
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaceId: string;
  readonly importId: string;
  readonly onUndone: () => void;
  readonly api?: Api;
}) {
  const t = useTranslations("portability.undo");
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const { pending, refusal, run, clear } = useCall();
  // Every way out forgets a refusal, so the next import's sheet opens clean.
  const close = () => {
    clear();
    onOpenChange(false);
  };
  const undo = async () => {
    const undone = await run(() =>
      api.POST("/api/v1/spaces/{spaceId}/imports/{importId}/undo", {
        params: { path: { spaceId, importId } },
      }),
    );
    if (undone) {
      close();
      onUndone();
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={t("title")}
      footer={
        <div className="flex flex-col gap-2">
          <Button variant="danger" size="lg" disabled={pending} onClick={() => void undo()}>
            {t("confirm")}
          </Button>
          <Button variant="ghost" size="lg" onClick={close}>
            {t("cancel")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-ink">{t("body")}</p>
        {refusal ? <RefusalNotice refusal={refusal} /> : null}
      </div>
    </Sheet>
  );
}

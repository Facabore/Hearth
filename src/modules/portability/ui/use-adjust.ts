"use client";

import { useMemo } from "react";
import { browserApi, type Api } from "@/shared/ui/api/client";
import type { ImportChangesDto, ImportPreviewDto } from "./dto";
import { useCall } from "./parts";

/** Where a draft lives and who hears of its new preview. */
export interface DraftPlace {
  readonly spaceId: string;
  readonly importId: string;
  /** The draft's new preview, after a change the API accepted. */
  readonly onAdjusted: (preview: ImportPreviewDto) => void;
  readonly api?: Api;
}

/** Design §3.2's adjust: one change to a draft, answered with its new preview; a refusal is kept for the screen. */
export const useAdjust = ({ spaceId, importId, onAdjusted, api: injected }: DraftPlace) => {
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const call = useCall();
  const adjust = async (changes: ImportChangesDto): Promise<boolean> => {
    const preview = await call.run(() =>
      api.PATCH("/api/v1/spaces/{spaceId}/imports/{importId}", {
        params: { path: { spaceId, importId } },
        body: changes,
      }),
    );
    if (preview) onAdjusted(preview);
    return preview !== null;
  };
  return { ...call, adjust, api };
};

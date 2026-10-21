"use client";

import { useEffect, useRef, useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import type { SplitMethod } from "./split-math";

export const DEFAULT_SPLIT_DELAY_MS = 250;

export type DefaultSplitState =
  | { readonly status: "none" }
  | {
      readonly status: "ready";
      /** `<category>|<date>|<amount>` of the request this answers. */
      readonly key: string;
      readonly method: "BY_ALLOCATION" | "EQUAL";
      readonly availableMethods: readonly SplitMethod[];
      readonly shares: readonly { readonly memberId: string; readonly amount: string }[] | null;
    };

/**
 * HU-E6-08, ruling P167: the default split of the expense being typed, asked 250 ms after the category, the date or
 * the amount last changed. Only the latest request may answer; a failure answers none (the form then offers EQUAL).
 * `amount` is the positive amount in minor units, or null (the API refuses 0, so it is then left out).
 */
export const useDefaultSplit = (input: {
  readonly api: Api;
  readonly spaceId: string;
  readonly categoryId: string | null;
  readonly date: string;
  readonly amount: string | null;
  readonly enabled: boolean;
}): DefaultSplitState => {
  const { api, spaceId, categoryId, date, amount, enabled } = input;
  const [state, setState] = useState<DefaultSplitState>({ status: "none" });
  const latest = useRef("");
  useEffect(() => {
    if (!enabled || categoryId === null) return;
    const key = `${categoryId}|${date}|${amount ?? ""}`;
    latest.current = key;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const { data } = await api.GET("/api/v1/spaces/{spaceId}/default-split", {
            params: {
              path: { spaceId },
              query: { categoryId, date, ...(amount === null ? {} : { amount }) },
            },
          });
          if (latest.current !== key) return;
          setState(
            data
              ? {
                  status: "ready",
                  key,
                  method: data.method,
                  availableMethods: data.availableMethods,
                  shares:
                    data.shares?.map((s) => ({ memberId: s.memberId, amount: s.amount.amount })) ?? null,
                }
              : { status: "none" },
          );
        } catch {
          if (latest.current === key) setState({ status: "none" });
        }
      })();
    }, DEFAULT_SPLIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, spaceId, categoryId, date, amount, enabled]);
  return enabled && categoryId !== null ? state : { status: "none" };
};

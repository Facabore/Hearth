"use client";

import { useEffect, useRef, useState } from "react";
import type { Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import type { Schedule } from "./recurrence-request";

export const PREVIEW_DELAY_MS = 250;
export const PREVIEW_COUNT = 3;

export type SchedulePreview =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly dates: readonly string[] }
  | { readonly status: "failed"; readonly problem: Problem };

/**
 * Ruling P269: the dates a draft schedule would record, from `POST …/recurrences/preview`, never from the browser's
 * own date math (the story's technical note). Asked 250 ms after the schedule or its dates last changed; only the
 * latest request answers.
 */
export const useSchedulePreview = (input: {
  readonly api: Api;
  readonly spaceId: string;
  readonly schedule: Schedule;
  readonly startDate: string;
  readonly endDate: string | null;
}): SchedulePreview => {
  const { api, spaceId, schedule, startDate, endDate } = input;
  const key = JSON.stringify([spaceId, schedule, startDate, endDate]);
  const [answer, setAnswer] = useState<{ key: string; preview: SchedulePreview } | null>(null);
  const latest = useRef("");
  useEffect(() => {
    latest.current = key;
    const [space, asked, start, end] = JSON.parse(key) as [string, Schedule, string, string | null];
    const timer = setTimeout(() => {
      void (async () => {
        let preview: SchedulePreview;
        try {
          const { data, error, response } = await api.POST("/api/v1/spaces/{spaceId}/recurrences/preview", {
            params: { path: { spaceId: space } },
            body: {
              schedule: asked,
              startDate: start,
              ...(end ? { endDate: end } : {}),
              count: PREVIEW_COUNT,
            },
          });
          preview =
            response.ok && data
              ? { status: "ready", dates: data.dates }
              : { status: "failed", problem: problemFrom(error, response) };
        } catch (error) {
          preview = { status: "failed", problem: problemFrom(error, undefined) };
        }
        if (latest.current === key) setAnswer({ key, preview });
      })();
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, key]);
  return answer?.key === key ? answer.preview : { status: "loading" };
};

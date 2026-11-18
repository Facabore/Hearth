import { useEffect, useState } from "react";
import type { Api } from "@/shared/ui/api/client";

/** What Registrar knows of the day's rate: still asking, the rate and the day it is from, or none for that day. */
export type RateState =
  | { readonly status: "loading" }
  | { readonly status: "found"; readonly rate: string; readonly on: string }
  | { readonly status: "missing" };

/**
 * P342 (board 4): the day's rate from the movement's currency (`base`) to the account's (`quote`), read from
 * `GET /api/v1/exchange-rates` for the form's date, to suggest what the account moved. Null when no pair is asked
 * for; "missing" when no stored rate connects them by that day (404 `ExchangeRateNotFound`) or the read failed, so the
 * card asks for the value. Kept with the pair and day it was read for, so a change never shows the previous one's.
 */
export const useExchangeRate = (
  api: Api,
  pair: { readonly base: string; readonly quote: string; readonly on: string } | null,
): RateState | null => {
  const key = pair ? `${pair.base}|${pair.quote}|${pair.on}` : null;
  const [read, setRead] = useState<{ readonly key: string; readonly state: RateState } | null>(null);
  const base = pair?.base;
  const quote = pair?.quote;
  const on = pair?.on;
  useEffect(() => {
    if (key === null || base === undefined || quote === undefined || on === undefined) return;
    let live = true;
    const answer = (state: RateState) => {
      if (live) setRead({ key, state });
    };
    api
      .GET("/api/v1/exchange-rates", { params: { query: { base, quote, on } } })
      .then(({ data }) =>
        answer(data ? { status: "found", rate: data.rate, on: data.on } : { status: "missing" }),
      )
      .catch(() => answer({ status: "missing" }));
    return () => {
      live = false;
    };
  }, [api, key, base, quote, on]);
  if (key === null) return null;
  return read?.key === key ? read.state : { status: "loading" };
};

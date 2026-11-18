import { useEffect, useState } from "react";
import type { Api } from "@/shared/ui/api/client";

/** How long the pair and amount must stay still before the rate is asked, so a change sends one request. */
const DELAY_MS = 250;

/**
 * What Saldar knows of the day's rate for an exchange (ruling P342, board 3): still asking, the rate with the server's
 * conversion of the settled amount (null when it sent none), or none for that day.
 */
export type SettleRate =
  | { readonly status: "loading" }
  | { readonly status: "found"; readonly rate: string; readonly converted: string | null }
  | { readonly status: "missing" };

/**
 * Ruling P342 (S5): the day's rate from the debt's currency (`base`) to the one the money moved in (`quote`), from
 * `GET /api/v1/exchange-rates` with `amount` (the settled minor units) converted by the server, which the sheet suggests
 * as what was received or paid; the UI never rounds money itself (AGENTS.md). Only the latest request answers; "missing"
 * when no stored rate connects them by that day (404 `ExchangeRateNotFound`) or the read failed. Null when nothing is
 * exchanged.
 */
export const useSettleRate = (
  api: Api,
  ask: { readonly base: string; readonly quote: string; readonly on: string; readonly amount: string } | null,
): SettleRate | null => {
  const key = ask ? `${ask.base}|${ask.quote}|${ask.on}|${ask.amount}` : null;
  const [read, setRead] = useState<{ readonly key: string; readonly state: SettleRate } | null>(null);
  useEffect(() => {
    if (key === null || ask === null) return;
    let current = true;
    const answer = (state: SettleRate) => {
      if (current) setRead({ key, state });
    };
    const timer = setTimeout(() => {
      api
        .GET("/api/v1/exchange-rates", { params: { query: { ...ask } } })
        .then(({ data }) =>
          answer(
            data
              ? { status: "found", rate: data.rate, converted: data.converted?.amount ?? null }
              : { status: "missing" },
          ),
        )
        .catch(() => answer({ status: "missing" }));
    }, DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // `ask` is read through `key`, which names every field of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  if (key === null) return null;
  return read?.key === key ? read.state : { status: "loading" };
};

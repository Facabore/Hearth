import { useEffect, useRef, useState } from "react";
import type { Api } from "@/shared/ui/api/client";

/** How long the amount must stay still before its conversion is asked, so typing sends one request, not one a key. */
export const EXCHANGE_RATE_DELAY_MS = 250;

/**
 * What Registrar knows of the day's rate: still asking, the rate and the day it is from with the server's conversion
 * of the amount (null while that amount is not converted yet), or none for that day.
 */
export type RateState =
  | { readonly status: "loading" }
  | {
      readonly status: "found";
      readonly rate: string;
      readonly on: string;
      /** The amount in the account's minor units, by the API's own `Money.convert`; null until it answers for it. */
      readonly converted: string | null;
    }
  | { readonly status: "missing" };

type Read =
  | {
      readonly status: "found";
      readonly rate: string;
      readonly on: string;
      readonly converted: string | null;
    }
  | { readonly status: "missing" };

/**
 * P342 (board 4): the day's rate from the movement's currency (`base`) to the account's (`quote`), read from
 * `GET /api/v1/exchange-rates` for the form's date, with `amount` (the movement's positive minor units) converted by
 * the server, which the form suggests as what the account moved; the UI never rounds money itself (AGENTS.md). Asked
 * 250 ms after the pair, the day or the amount last changed, and only the latest request answers. Null when no pair is
 * asked for; "missing" when no stored rate connects them by that day (404 `ExchangeRateNotFound`) or the read failed,
 * so the card asks for the value. The rate of the same pair and day stays shown while a new amount settles; its
 * conversion is only ever the one of the amount now typed.
 */
export const useExchangeRate = (
  api: Api,
  pair: {
    readonly base: string;
    readonly quote: string;
    readonly on: string;
    readonly amount: string | null;
  } | null,
): RateState | null => {
  const pairKey = pair ? `${pair.base}|${pair.quote}|${pair.on}` : null;
  const amount = pair?.amount ?? null;
  const [read, setRead] = useState<{
    readonly pairKey: string;
    readonly amount: string | null;
    readonly state: Read;
  } | null>(null);
  const latest = useRef("");
  const base = pair?.base;
  const quote = pair?.quote;
  const on = pair?.on;
  useEffect(() => {
    if (pairKey === null || base === undefined || quote === undefined || on === undefined) return;
    const key = `${pairKey}|${amount ?? ""}`;
    latest.current = key;
    const answer = (state: Read) => {
      if (latest.current === key) setRead({ pairKey, amount, state });
    };
    const timer = setTimeout(() => {
      api
        .GET("/api/v1/exchange-rates", {
          params: { query: { base, quote, on, ...(amount === null ? {} : { amount }) } },
        })
        .then(({ data }) =>
          answer(
            data
              ? { status: "found", rate: data.rate, on: data.on, converted: data.converted?.amount ?? null }
              : { status: "missing" },
          ),
        )
        .catch(() => answer({ status: "missing" }));
    }, EXCHANGE_RATE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, pairKey, base, quote, on, amount]);
  if (pairKey === null) return null;
  if (read?.pairKey !== pairKey) return { status: "loading" };
  const { state } = read;
  if (state.status === "missing") return state;
  return { ...state, converted: read.amount === amount && amount !== null ? state.converted : null };
};

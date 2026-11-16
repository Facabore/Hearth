"use client";

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button, NumberField, ProblemNotice } from "@/shared/ui";
import type { Api } from "@/shared/ui/api/client";
import type { AccountDto } from "@/shared/ui/api/dto";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { AmountText } from "@/shared/ui/atoms/amount";
import { parseDecimal } from "@/shared/ui/format/amount-input";
import { currencyOf } from "@/shared/ui/format/currencies";
import { currencyTitle } from "@/shared/ui/format/currency-names";
import { formatDayMonthYear } from "@/shared/ui/format/day-month";
import { formatMoney, formatNumber, type Formats } from "@/shared/ui/format/formatters";
import { Sheet } from "@/shared/ui/molecules/sheet";

interface Preview {
  readonly rate: string | null;
  readonly rateDate: string | null;
  readonly movements: number;
  readonly balanceBefore: { readonly amount: string; readonly currency: string };
  readonly balanceAfter: { readonly amount: string; readonly currency: string } | null;
}

/** The most decimals a rate keeps: a cross rate such as COP to USD needs several. */
const RATE_DECIMALS = 10;
/** How long the typed rate rests before the preview asks again. */
const SETTLE_MS = 300;
/** "4020.50" and "4020.5" are one rate. */
const sameRate = (a: string | null, b: string | null): boolean => {
  const plain = (rate: string) => (rate.includes(".") ? rate.replace(/0+$/, "").replace(/\.$/, "") : rate);
  return a !== null && b !== null && plain(a) === plain(b);
};
/** Forces formatDayMonthYear to write the year: a rate's day may be in any year. */
const NO_YEAR = "0000-00-00";

/**
 * Ruling P336 (board "Cambiar moneda · tasa · hoja"): "Nueva moneda: Peso colombiano (COP)", the rate `1 US$ = [x] COP` filled
 * with the latest stored rate when there is one, what the balance becomes and how many movements convert, and
 * "Cambiar a COP". The preview follows the rate as it is typed; confirming converts the account and its movements.
 */
export function CurrencyChangeSheet({
  open,
  onOpenChange,
  spaceId,
  account,
  to,
  formats,
  api,
  onChanged,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly spaceId: string;
  readonly account: AccountDto;
  /** The new currency. */
  readonly to: string;
  readonly formats: Formats;
  readonly api: Api;
  readonly onChanged: () => void;
}) {
  const t = useTranslations("accounts.currencyChange");
  const common = useTranslations("common");
  const locale = useLocale();
  const from = account.openingBalance.currency;
  const path = { spaceId, accountId: account.id };
  const [rate, setRate] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [offered, setOffered] = useState<{ rate: string | null; date: string | null } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, setPending] = useState(false);
  const typed = rate.trim() === "" ? null : parseDecimal(rate, formats.numberFormat);

  // The first read offers the latest stored rate, which fills the field.
  useEffect(() => {
    let live = true;
    void api
      .GET("/api/v1/spaces/{spaceId}/accounts/{accountId}/currency", {
        params: { path, query: { currency: to } },
      })
      .then(({ data, error, response }) => {
        if (!live) return;
        if (!data) return setProblem(problemFrom(error, response));
        setOffered({ rate: data.rate, date: data.rateDate });
        setPreview(data);
        if (data.rate !== null) setRate(formatNumber(data.rate, formats));
      })
      .catch((error: unknown) => live && setProblem(problemFrom(error, undefined)));
    return () => {
      live = false;
    };
    // The account and the currency name the read; the rest is stable for the sheet's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, to]);

  // Then the preview follows the rate typed, once it rests.
  useEffect(() => {
    if (offered === null || typed === null || sameRate(typed, preview?.rate ?? null)) return;
    let live = true;
    const timer = setTimeout(() => {
      void api
        .GET("/api/v1/spaces/{spaceId}/accounts/{accountId}/currency", {
          params: { path, query: { currency: to, rate: typed } },
        })
        .then(({ data, error, response }) => {
          if (!live) return;
          // A rate the server refuses (one that turns a movement into nothing) says why at once, not only on confirm.
          setProblem(data ? null : problemFrom(error, response));
          if (data) setPreview(data);
        })
        .catch((error: unknown) => live && setProblem(problemFrom(error, undefined)));
    }, SETTLE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, offered]);

  const confirm = async () => {
    if (typed === null) {
      return;
    }
    setPending(true);
    setProblem(null);
    try {
      const { response, error } = await api.PUT("/api/v1/spaces/{spaceId}/accounts/{accountId}/currency", {
        params: { path },
        body: { currency: to, rate: typed },
      });
      if (response.ok) {
        onChanged();
        return;
      }
      setProblem(problemFrom(error, response));
    } catch (error) {
      setProblem(problemFrom(error, undefined));
    }
    setPending(false);
  };

  // The balance after is the preview's only while the preview was read at the rate in the field.
  const after = preview !== null && sameRate(typed, preview.rate) ? preview.balanceAfter : null;
  const hint =
    offered?.rate && offered.date
      ? t("hintStored", {
          date: formatDayMonthYear(
            offered.date,
            common(`monthShort.${Number(offered.date.slice(5, 7)) as 1}`),
            formats,
            NO_YEAR,
          ),
        })
      : t("hintNone");
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("title", { name: currencyTitle(to, locale), code: to })}
      description={t("subtitle", { account: account.name, code: from })}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-3">
          <span aria-hidden="true" className="flex h-[52px] shrink-0 items-center font-medium text-ink">
            {t("rateFrom", { symbol: currencyOf(from).symbol })}
          </span>
          <div className="min-w-0 flex-1">
            <NumberField
              id="currency-rate"
              label={t("rate")}
              kind="money"
              decimals={RATE_DECIMALS}
              numberFormat={formats.numberFormat}
              example={false}
              value={rate}
              onChange={setRate}
              trailing={<span className="px-3 font-medium text-ink">{to}</span>}
            />
          </div>
        </div>
        <p className="text-sm text-muted">{hint}</p>
        {preview ? (
          <div data-currency-result className="flex flex-col gap-1 rounded-xl bg-accent-soft p-3">
            {after ? (
              <p className="font-semibold text-accent">
                {t("balance", {
                  before: formatMoney(preview.balanceBefore, formats),
                  after: formatMoney(after, formats),
                })}
              </p>
            ) : (
              <p className="text-ink">
                <AmountText text={formatMoney(preview.balanceBefore, formats)} />
                {" · "}
                {t("needRate", { code: to })}
              </p>
            )}
            <p className="text-sm text-ink">{t("movements", { count: preview.movements })}</p>
          </div>
        ) : null}
        {problem ? <ProblemNotice problem={problem} /> : null}
        <Button size="lg" disabled={pending || typed === null} onClick={() => void confirm()}>
          {t("confirm", { code: to })}
        </Button>
        <Button variant="ghost" size="lg" onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Button>
      </div>
    </Sheet>
  );
}

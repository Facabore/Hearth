import type { MoneyDto } from "@/shared/ui/api/dto";
import { currencyOf } from "@/shared/ui/format/currencies";
import { formatMoney, type Formats } from "@/shared/ui/format/formatters";
import type { TrendPoint } from "./trend-series";

/**
 * Ruling P202: `Number` only positions a point; every figure shown is the API's string through `formatMoney`. Apart
 * from the series helpers the chart's own chunk holds, so that chunk never waits on the Plan views' (ruling P311).
 */
export const pointOf = (money: MoneyDto | null, formats: Pick<Formats, "numberFormat">): TrendPoint =>
  money === null
    ? { value: null, text: null }
    : {
        value: Number(money.amount) / 10 ** currencyOf(money.currency).exponent,
        text: formatMoney(money, formats),
      };

import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { localDate, ok } from "@/shared/kernel";
import { exchangeRateDto, ExchangeRateQuerySchema } from "@/modules/rates/contracts/rates.contract";

export const runtime = "nodejs";

/** P342: the day's rate between two currencies, and an amount converted at it, to suggest an account leg. */
export const GET = defineRoute({
  auth: "required",
  query: ExchangeRateQuerySchema,
  handler: async ({ query }) => {
    const on = localDate(query.on);
    if (!on.ok) return on;
    const result = await getContainer().rates.getExchangeRate({
      base: query.base,
      quote: query.quote,
      on: on.value,
      ...(query.amount === undefined ? {} : { amount: BigInt(query.amount) }),
    });
    return result.ok ? ok({ status: 200, body: exchangeRateDto(result.value) }) : result;
  },
});

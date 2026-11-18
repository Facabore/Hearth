import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, moneyToDto, problems, securedByUser } from "@/shared/http/contracts";
import type { QuotedRate } from "../application";

const CurrencyCode = z.string().regex(/^[A-Z]{3}$/, { error: "An ISO 4217 code such as USD" });

/** P342: the pair and day a rate is asked for; two different currencies; and an amount to convert, when wanted. */
export const ExchangeRateQuerySchema = z
  .object({
    base: CurrencyCode.describe("The currency one unit of which the rate prices, such as USD."),
    quote: CurrencyCode.describe("The currency the rate is given in, such as COP."),
    on: z.iso.date().describe("The day the rate is wanted for: the movement's date."),
    amount: MoneySchema.shape.amount
      .optional()
      .describe(
        'Minor units of `base` to convert at the rate, as an integer string like Money\'s `amount` ("5000" is 50,00 USD). ' +
          "With it the answer adds `converted`.",
      ),
  })
  .refine((query) => query.base !== query.quote, { error: "base and quote must differ", path: ["quote"] });

export const ExchangeRateSchema = z.object({
  rate: z
    .string()
    .describe(
      'How many units of `quote` one unit of `base` is worth, as an exact decimal such as "4100.25".',
    ),
  on: z.iso
    .date()
    .describe(
      "The day of the stored rate it rests on: the day asked for or the latest one before it (for a rate through a pivot currency, the oldest of the rates it went through).",
    ),
  converted: MoneySchema.optional().describe(
    "Only when `amount` is asked: that amount in `quote` at this rate, rounded half to even at `quote`'s minor unit " +
      "(Money's own conversion, D30), the figure the app suggests as an account leg.",
  ),
});

export const exchangeRateDto = (quoted: QuotedRate): z.infer<typeof ExchangeRateSchema> => ({
  rate: quoted.rate.value,
  on: quoted.on,
  ...(quoted.converted === undefined ? {} : { converted: moneyToDto(quoted.converted) }),
});

export const ratesPaths: ZodOpenApiPathsObject = {
  "/api/v1/exchange-rates": {
    get: {
      operationId: "getExchangeRate",
      summary: "The day's exchange rate between two currencies (P342, D30)",
      description:
        "The rate the ledger converts a movement of that day at, from the stored daily rates (ECB and TRM), directly " +
        "or through a pivot currency. The app suggests an account leg from it (what an account in another currency " +
        "moved); the person may change the figure, and the rate itself is never stored on a movement. With `amount` " +
        "it also answers that amount converted (`converted`), so the app never rounds money itself.",
      ...securedByUser,
      requestParams: { query: ExchangeRateQuerySchema },
      responses: {
        "200": {
          description: "The rate, the day it is from, and the converted amount when one was asked",
          content: jsonContent(ExchangeRateSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "ExchangeRateNotFound: no stored rate connects the currencies by that day",
          "422": "ValidationFailed, UnknownCurrency",
        }),
      },
    },
  },
};

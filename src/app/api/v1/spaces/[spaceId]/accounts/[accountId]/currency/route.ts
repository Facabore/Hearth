import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  accountDto,
  ChangeAccountCurrencyBodySchema,
  currencyPreviewDto,
  PreviewAccountCurrencyQuerySchema,
} from "@/modules/accounts/contracts/accounts.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Ruling P336: what changing the account's currency would do, at the rate given or the latest stored one. */
export const GET = defineRoute({
  auth: "required",
  query: PreviewAccountCurrencyQuerySchema,
  handler: async ({ user, params, query }) => {
    const result = await getContainer().accounts.previewAccountCurrency({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
      currency: query.currency,
      rate: query.rate,
    });
    return result.ok ? ok({ status: 200, body: currencyPreviewDto(result.value) }) : result;
  },
});

/** Ruling P336: the account in its new currency, its money converted at the rate the person confirmed. */
export const PUT = defineRoute({
  auth: "required",
  body: ChangeAccountCurrencyBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().accounts.changeAccountCurrency({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
      currency: body.currency,
      rate: body.rate,
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : result;
  },
});

import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  accountDto,
  attributesFromBody,
  GetAccountQuerySchema,
  termsFromBody,
  UpdateAccountBodySchema,
  withPublicField,
} from "@/modules/accounts/contracts/accounts.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: GetAccountQuerySchema,
  handler: async ({ user, params, query }) => {
    const asOf = optionalLocalDate(query.asOf);
    if (!asOf.ok) return asOf;
    const result = await getContainer().accounts.getAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
      asOf: asOf.value,
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : result;
  },
});

export const PATCH = defineRoute({
  auth: "required",
  body: UpdateAccountBodySchema,
  handler: async ({ user, params, body }) => {
    const openingBalance =
      body.openingBalance === undefined ? ok(undefined) : moneyFromDto(body.openingBalance);
    if (!openingBalance.ok) return openingBalance;
    const terms = termsFromBody(body.terms);
    if (!terms.ok) return terms;
    const result = await getContainer().accounts.updateAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
      changes: {
        name: body.name,
        type: body.type,
        openingBalance: openingBalance.value,
        attributes: attributesFromBody(body),
        terms: terms.value,
      },
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : withPublicField(result);
  },
});

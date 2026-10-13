import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  accountDto,
  CreateAccountBodySchema,
  ListAccountsQuerySchema,
} from "@/modules/accounts/contracts/accounts.contract";
import { moneyFromDto, optionalLocalDate } from "@/shared/http/contracts";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: ListAccountsQuerySchema,
  handler: async ({ user, params, query }) => {
    const asOf = optionalLocalDate(query.asOf);
    if (!asOf.ok) return asOf;
    const result = await getContainer().accounts.listAccounts({
      spaceId: params.spaceId!,
      userId: user!.id,
      includeArchived: query.archived === "true",
      asOf: asOf.value,
    });
    return result.ok ? ok({ status: 200, body: { items: result.value.map(accountDto) } }) : result;
  },
});

export const POST = defineRoute({
  auth: "required",
  body: CreateAccountBodySchema,
  handler: async ({ user, params, body }) => {
    const openingBalance = moneyFromDto(body.openingBalance);
    if (!openingBalance.ok) return openingBalance;
    const result = await getContainer().accounts.createAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      name: body.name,
      type: body.type,
      openingBalance: openingBalance.value,
    });
    return result.ok ? ok({ status: 201, body: accountDto(result.value) }) : result;
  },
});

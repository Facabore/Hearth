import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { MyAccountsQuerySchema, myAccountsDto } from "@/modules/accounts/contracts/accounts.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** #338: the accounts of each of the signed-in person's active spaces, in one read. */
export const GET = defineRoute({
  auth: "required",
  query: MyAccountsQuerySchema,
  handler: async ({ user, query }) => {
    const result = await getContainer().accounts.listMyAccounts({
      userId: user!.id,
      includeArchived: query.archived === "true",
    });
    return result.ok ? ok({ status: 200, body: myAccountsDto(result.value) }) : result;
  },
});

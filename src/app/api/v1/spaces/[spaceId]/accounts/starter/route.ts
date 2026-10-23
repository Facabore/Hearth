import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { starterAccountsDto } from "@/modules/accounts/contracts/accounts.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

/** Issue 169: the Accounts screen's empty state creates the starter accounts the personal space lacks. */
export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().accounts.createStarterAccounts({
      spaceId: params.spaceId!,
      userId: user!.id,
      locale: user!.locale,
    });
    return result.ok ? ok({ status: 200, body: starterAccountsDto(result.value) }) : result;
  },
});

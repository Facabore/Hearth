import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { accountDto } from "@/modules/accounts/contracts/accounts.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().accounts.restoreAccount({
      spaceId: params.spaceId!,
      userId: user!.id,
      accountId: params.accountId!,
    });
    return result.ok ? ok({ status: 200, body: accountDto(result.value) }) : result;
  },
});

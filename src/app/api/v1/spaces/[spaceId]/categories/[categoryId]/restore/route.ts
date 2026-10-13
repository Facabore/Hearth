import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { categoryDto } from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  handler: async ({ user, params }) => {
    const result = await getContainer().categories.restoreCategory({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: params.categoryId!,
    });
    return result.ok ? ok({ status: 200, body: categoryDto(result.value) }) : result;
  },
});

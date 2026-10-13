import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import {
  CategoryGroupBodySchema,
  categoryGroupDto,
} from "@/modules/categories/contracts/categories.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: CategoryGroupBodySchema,
  handler: async ({ user, params, body }) => {
    const result = await getContainer().categories.createCategoryGroup({
      spaceId: params.spaceId!,
      userId: user!.id,
      name: body.name,
    });
    return result.ok ? ok({ status: 201, body: categoryGroupDto(result.value) }) : result;
  },
});

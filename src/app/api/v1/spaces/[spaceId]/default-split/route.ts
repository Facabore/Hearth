import { getContainer } from "@/composition/container";
import { defineRoute } from "@/composition/route";
import { DefaultSplitQuerySchema, defaultSplitDto } from "@/modules/budgeting/contracts/budgeting.contract";
import { localDate, ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const GET = defineRoute({
  auth: "required",
  query: DefaultSplitQuerySchema,
  handler: async ({ user, params, query }) => {
    const date = localDate(query.date);
    if (!date.ok) return date;
    const result = await getContainer().budgeting.resolveDefaultSplit({
      spaceId: params.spaceId!,
      userId: user!.id,
      categoryId: query.categoryId,
      date: date.value,
      amount: query.amount === undefined ? null : BigInt(query.amount),
    });
    return result.ok ? ok({ status: 200, body: defaultSplitDto(result.value) }) : result;
  },
});

import { getContainer } from "@/composition/container";
import { defineRoute, withIdempotency } from "@/composition/route";
import {
  DirectSplitBodySchema,
  directSplitDto,
  directSplitFromBody,
  peopleSplitDto,
  transactionHeaders,
} from "@/modules/ledger/contracts/ledger.contract";
import { ok } from "@/shared/kernel";

export const runtime = "nodejs";

export const POST = defineRoute({
  auth: "required",
  body: DirectSplitBodySchema,
  before: withIdempotency,
  handler: async ({ user, body }) => {
    const request = directSplitFromBody(body);
    if (!request.ok) return request;
    const requester = { userId: user!.id, userName: user!.name, locale: user!.locale };
    const { spaces } = getContainer();
    if (request.value.kind === "ONE") {
      const { counterpart, expense } = request.value;
      const result = await spaces.splitWithPerson({ ...requester, counterpart, expense });
      return result.ok
        ? ok({
            status: 201,
            body: directSplitDto(result.value),
            headers: transactionHeaders(result.value.recorded.expense),
          })
        : result;
    }
    // P331: several people, each part in its pair's direct space and the requester's own in their personal space.
    const { people, own } = request.value;
    const result = await spaces.splitWithPeople({ ...requester, people, own });
    return result.ok
      ? ok({
          status: 201,
          body: peopleSplitDto(result.value),
          headers: transactionHeaders(result.value.people[0]!.recorded.expense),
        })
      : result;
  },
});

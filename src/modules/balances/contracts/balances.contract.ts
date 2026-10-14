import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import type { SettlementSuggestions, SpaceBalances } from "../application";

/**
 * HU-E5-01: one entry per current member in join order, guests included, then every former member with
 * a non-zero history in the space; positive net means owed money.
 */
export const SpaceBalancesSchema = z.object({
  members: z.array(z.object({ memberId: z.string(), net: MoneySchema })),
});

export const spaceBalancesDto = (balances: SpaceBalances): z.infer<typeof SpaceBalancesSchema> => ({
  members: balances.members.map((m) => ({
    memberId: m.memberId,
    net: { amount: m.net.toString(), currency: balances.currency },
  })),
});

/** HU-E5-03: each suggestion has the fields of a settlement (HU-E5-02); POST it to accept it. */
export const SettlementSuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({ payerMemberId: z.string(), receivingMemberId: z.string(), amount: MoneySchema }),
  ),
});

export const settlementSuggestionsDto = (
  s: SettlementSuggestions,
): z.infer<typeof SettlementSuggestionsSchema> => ({
  suggestions: s.suggestions.map((suggestion) => ({
    payerMemberId: suggestion.payerMemberId,
    receivingMemberId: suggestion.receivingMemberId,
    amount: { amount: suggestion.amount.toString(), currency: s.currency },
  })),
});

const SpacePath = z.object({ spaceId: z.string() });

export const balancesPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/balances": {
    get: {
      operationId: "getSpaceBalances",
      summary: "Net balance of every member; fund-paid expenses and fund contributions create no debt",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": {
          description: "Balances in join order; they always sum to zero",
          content: jsonContent(SpaceBalancesSchema),
        },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/balances/suggestions": {
    get: {
      operationId: "getSettlementSuggestions",
      summary: "Payments that clear every balance, at most one fewer than the members; computed on read",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": {
          description: "Suggested settlements, the largest debts first",
          content: jsonContent(SettlementSuggestionsSchema),
        },
        ...problems({ "401": "Unauthenticated", "404": "SpaceNotFound" }),
      },
    },
  },
};

import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import type { FriendNameView } from "@/modules/spaces/application";
import type {
  Friend,
  MemberBalanceHistoryView,
  MyBalance,
  SettlementSuggestions,
  SpaceBalances,
} from "../application";

/**
 * HU-E5-01: one entry per current member in join order, guests included, then every former member with
 * a non-zero history in the space; positive net means owed money.
 */
export const SpaceBalancesSchema = z.object({
  members: z.array(
    z.object({
      memberId: z.string(),
      net: MoneySchema,
      hasMovements: z.boolean().optional().meta({
        description:
          "#217 (P263): true once a live member-paid expense (as payer or participant) or a live settlement names the member, even when their net is back to 0. Fund-paid expenses, fund contributions and deleted movements do not count. Computed on read; always sent, optional for older clients.",
      }),
    }),
  ),
});

export const spaceBalancesDto = (balances: SpaceBalances): z.infer<typeof SpaceBalancesSchema> => ({
  members: balances.members.map((m) => ({
    memberId: m.memberId,
    net: { amount: m.net.toString(), currency: balances.currency },
    hasMovements: m.hasMovements,
  })),
});

/**
 * HU-E5-03: each suggestion has the fields of a settlement (HU-E5-02); POST it to accept it. A suggestion
 * that names a former member (possible only after the race tracked on #89) cannot be accepted until #89 lands.
 */
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

/**
 * #240 (ruling P278): the viewer's standing in each of her active shared and direct spaces, computed on read (D7) like
 * `GET /api/v1/spaces/{spaceId}/balances`; the personal space has no balances and is not listed.
 */
export const MyBalancesSchema = z.object({
  items: z.array(
    z.object({
      spaceId: z.string(),
      memberId: z.string().meta({ description: "The viewer's member id in the space" }),
      net: MoneySchema.meta({
        description: "The viewer's net; negative when it is her turn to put money in",
      }),
      members: z.array(z.object({ memberId: z.string(), name: z.string() })).meta({
        description: "The current members in join order, guests included",
      }),
      payments: z
        .array(z.object({ receivingMemberId: z.string(), amount: MoneySchema }))
        .meta({ description: "The settle-up suggestions in which the viewer pays, the largest first" }),
    }),
  ),
});

export const myBalancesDto = (balances: readonly MyBalance[]): z.infer<typeof MyBalancesSchema> => ({
  items: balances.map((b) => {
    const money = (minor: bigint) => ({ amount: minor.toString(), currency: b.currency });
    return {
      spaceId: b.spaceId,
      memberId: b.memberId,
      net: money(b.net),
      members: b.members.map((m) => ({ memberId: m.memberId, name: m.name })),
      payments: b.payments.map((p) => ({ receivingMemberId: p.receivingMemberId, amount: money(p.amount) })),
    };
  }),
});

/** Ruling P338: the other member of a direct space, by the name its viewer gives them. */
const FriendNameFields = {
  other: z.object({
    memberId: z.string(),
    kind: z.enum(["USER", "GUEST"]),
    displayName: z.string().meta({ description: "The name the space knows them by" }),
    nickname: z.string().nullable().meta({
      description:
        "The viewer's own apodo for a registered person, which nobody else sees; always null for a guest, whose apodo is its displayName",
    }),
  }),
  name: z.string().meta({ description: "What the viewer calls them: nickname ?? displayName" }),
};

/** Ruling P338: Amigos, one entry per active direct space of the viewer. */
export const MyFriendsSchema = z.object({
  items: z.array(
    z.object({
      spaceId: z.string(),
      me: z.object({ memberId: z.string() }),
      ...FriendNameFields,
      net: MoneySchema.meta({
        description:
          "The viewer's net in the space: positive when the other one owes her, negative when she owes them",
      }),
      lastMovement: z
        .object({
          transactionId: z.string(),
          date: z.iso.date(),
          description: z.string(),
          type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT", "ADJUSTMENT"]),
        })
        .nullable()
        .meta({ description: "The newest live movement of the space; null when none is left" }),
    }),
  ),
});

export const myFriendsDto = (friends: readonly Friend[]): z.infer<typeof MyFriendsSchema> => ({
  items: friends.map((f) => ({
    spaceId: f.spaceId,
    me: { memberId: f.me.memberId },
    other: { ...f.other },
    name: f.name,
    net: { amount: f.net.toString(), currency: f.currency },
    lastMovement: f.lastMovement === null ? null : { ...f.lastMovement },
  })),
});

/** Ruling P338: trimmed and 1–40 characters (InvalidNickname otherwise); null clears a registered person's apodo. */
export const FriendNicknameBodySchema = z.object({ nickname: z.string().nullable() });

export const FriendNameSchema = z.object({ spaceId: z.string(), ...FriendNameFields });

export const friendNameDto = (view: FriendNameView): z.infer<typeof FriendNameSchema> => ({
  spaceId: view.spaceId,
  other: { ...view.other },
  name: view.name,
});

/** HU-E5-04: an optional span of dates; `from` must not be after `to`. */
export const BalanceHistoryQuerySchema = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((query) => query.from === undefined || query.to === undefined || query.from <= query.to, {
    error: "from must not be after to",
    path: ["to"],
  });

/** HU-E5-04: a member's running net balance, movement by movement (ruling P29). */
export const BalanceHistorySchema = z.object({
  memberId: z.string(),
  from: z.iso.date().nullable(),
  to: z.iso.date().nullable(),
  /** The net as of the day before `from` (0 without `from`). */
  opening: MoneySchema,
  /** The net after the last entry, or the opening balance without entries. */
  closing: MoneySchema,
  entries: z.array(
    z.object({
      transactionId: z.string(),
      type: z.enum(["EXPENSE", "SETTLEMENT"]),
      date: z.iso.date(),
      description: z.string(),
      /** What the movement did to the member's net. */
      change: MoneySchema,
      /** The member's net after it. */
      balance: MoneySchema,
      /** Ruling P322: a SETTLEMENT's reason (PAYMENT, GIFT or FORGIVENESS); absent on an EXPENSE. */
      settlementReason: z.enum(["PAYMENT", "GIFT", "FORGIVENESS"]).optional(),
      /** Ruling P322: a SETTLEMENT's payer and receiver, so the screen can say who paid whom. */
      payerMemberId: z.string().optional(),
      receivingMemberId: z.string().optional(),
      /**
       * Ruling P322: the member a payment was made for. Their history lists it with a change of 0: the debt only moved
       * to the payer.
       */
      onBehalfOfMemberId: z.string().nullable().optional(),
      /** Ruling P322: the other half of a gift, so the screen pairs the payment for the member with its GIFT. */
      linkedTransactionId: z.string().nullable().optional(),
    }),
  ),
});

export const balanceHistoryDto = (
  history: MemberBalanceHistoryView,
): z.infer<typeof BalanceHistorySchema> => {
  const money = (minor: bigint) => ({ amount: minor.toString(), currency: history.currency });
  return {
    memberId: history.memberId,
    from: history.from,
    to: history.to,
    opening: money(history.opening),
    closing: money(history.closing),
    entries: history.entries.map((entry) => ({
      transactionId: entry.transactionId,
      type: entry.type,
      date: entry.date,
      description: entry.description,
      change: money(entry.change),
      balance: money(entry.balance),
      // Ruling P322: present on a settlement only, so an expense entry answers as before.
      ...(entry.settlementReason === undefined
        ? {}
        : {
            settlementReason: entry.settlementReason,
            payerMemberId: entry.payerMemberId,
            receivingMemberId: entry.receivingMemberId,
            onBehalfOfMemberId: entry.onBehalfOfMemberId ?? null,
            linkedTransactionId: entry.linkedTransactionId ?? null,
          }),
    })),
  };
};

const SpacePath = z.object({ spaceId: z.string() });
const MemberPath = SpacePath.extend({ memberId: z.string() });

export const balancesPaths: ZodOpenApiPathsObject = {
  "/api/v1/me/balances": {
    get: {
      operationId: "getMyBalances",
      summary:
        "The signed-in person's net in each of her shared and direct spaces, with her settle-up payments",
      description:
        "Computed on read, as each space's balances are. Archived spaces and the personal space are not listed; a space with nothing moved answers a net of 0 and no payments.",
      ...securedByUser,
      responses: {
        "200": {
          description: "One entry per active shared or direct space",
          content: jsonContent(MyBalancesSchema),
        },
        ...problems({ "401": "Unauthenticated" }),
      },
    },
  },
  "/api/v1/me/friends": {
    get: {
      operationId: "listMyFriends",
      summary:
        "Amigos: each person the signed-in person shares a direct space with, her net and the last movement",
      description:
        "One entry per active direct space, newest last movement first, then by name. Computed on read, as each space's balances are. The nickname is the viewer's own and nobody else sees it.",
      ...securedByUser,
      responses: {
        "200": { description: "One entry per active direct space", content: jsonContent(MyFriendsSchema) },
        ...problems({ "401": "Unauthenticated" }),
      },
    },
  },
  "/api/v1/me/friends/{spaceId}": {
    patch: {
      operationId: "setFriendNickname",
      summary: "Give the other member of a direct space an apodo",
      description:
        "For a registered person the apodo is the caller's own and nobody else sees it; null clears it. For a guest it renames the guest in the space, so null is refused and the name must be free in the space.",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(FriendNicknameBodySchema) },
      responses: {
        "200": { description: "The other member by the new name", content: jsonContent(FriendNameSchema) },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "409": "NotADirectSpace, MemberNameTaken, NotAGuest, SpaceArchived",
          "422": "ValidationFailed, InvalidNickname",
        }),
      },
    },
  },
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
      summary:
        "Payments between each pair of members, from the one who owes to the one owed; computed on read",
      description:
        "Each suggestion has the fields of a settlement; POST it to accept it. A suggestion that names a former member (possible only after the race tracked on #89) cannot be accepted until #89 lands.",
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
  "/api/v1/spaces/{spaceId}/members/{memberId}/balance-history": {
    get: {
      operationId: "getMemberBalanceHistory",
      summary:
        "How a member's net balance evolved: each expense and settlement that moved it, with the running balance",
      description:
        "Both bounds are optional and inclusive. `opening` is the balance after every movement before `from`, and each entry's running `balance` counts every earlier movement, also those before `from`. `closing` is the balance after the last entry, or `opening` when there are none. `from` after `to` is a 422 ValidationFailed.",
      ...securedByUser,
      requestParams: { path: MemberPath, query: BalanceHistoryQuerySchema },
      responses: {
        "200": {
          description: "The opening balance, the movements by date and the closing balance",
          content: jsonContent(BalanceHistorySchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound, MemberNotFound",
          "422": "ValidationFailed, InvalidDate",
        }),
      },
    },
  },
};

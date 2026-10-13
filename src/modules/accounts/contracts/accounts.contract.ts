import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import { ACCOUNT_TYPES, type AccountView } from "../application";

const AccountTypeSchema = z.enum(ACCOUNT_TYPES);

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  ownerUserId: z.string().nullable(),
  openingBalance: MoneySchema,
  /** Opening balance plus ledger movements, computed on read (HU-E2-04). */
  balance: MoneySchema,
  archivedAt: z.iso.datetime().nullable(),
});

export const CreateAccountBodySchema = z.object({
  name: z.string().max(200),
  type: AccountTypeSchema,
  openingBalance: MoneySchema,
});
export const UpdateAccountBodySchema = z.object({
  name: z.string().max(200).optional(),
  type: AccountTypeSchema.optional(),
  openingBalance: MoneySchema.optional(),
});
export const GetAccountQuerySchema = z.object({ asOf: z.iso.date().optional() });
export const ListAccountsQuerySchema = GetAccountQuerySchema.extend({
  archived: z.enum(["true", "false"]).optional(),
});
export const ListAccountsResponseSchema = z.object({ items: z.array(AccountSchema) });

export const accountDto = (view: AccountView): z.infer<typeof AccountSchema> => ({
  id: view.id,
  name: view.name,
  type: view.type,
  ownerUserId: view.ownerUserId,
  openingBalance: { amount: view.openingBalance.toString(), currency: view.currency },
  balance: { amount: view.balance.toString(), currency: view.currency },
  archivedAt: view.archivedAt?.toISOString() ?? null,
});

const SpacePath = z.object({ spaceId: z.string() });
const AccountPath = SpacePath.extend({ accountId: z.string() });
const one = (description: string) => ({ description, content: jsonContent(AccountSchema) });

export const accountsPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/accounts": {
    get: {
      operationId: "listAccounts",
      summary: "Accounts of a space with computed balances; archived ones only with archived=true",
      ...securedByUser,
      requestParams: { path: SpacePath, query: ListAccountsQuerySchema },
      responses: {
        "200": { description: "Accounts sorted by name", content: jsonContent(ListAccountsResponseSchema) },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed, InvalidDate",
        }),
      },
    },
    post: {
      operationId: "createAccount",
      summary: "Create an account with an opening balance",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: jsonContent(CreateAccountBodySchema) },
      responses: {
        "201": one("The new account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "AccountNameTaken, SharedFundRequiresSharedSpace, PersonalAccountRequiresPersonalSpace",
          "422": "ValidationFailed, InvalidAccountName, UnknownCurrency, CurrencyMismatch",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/accounts/{accountId}": {
    get: {
      operationId: "getAccount",
      summary: "One account with its computed balance",
      ...securedByUser,
      requestParams: { path: AccountPath, query: GetAccountQuerySchema },
      responses: {
        "200": one("The account"),
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound, AccountNotFound",
          "422": "ValidationFailed, InvalidDate",
        }),
      },
    },
    patch: {
      operationId: "updateAccount",
      summary: "Rename an account or correct its opening balance (the type never changes)",
      ...securedByUser,
      requestParams: { path: AccountPath },
      requestBody: { content: jsonContent(UpdateAccountBodySchema) },
      responses: {
        "200": one("The updated account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, AccountNotFound",
          "409": "AccountNameTaken, AccountTypeImmutable",
          "422": "ValidationFailed, InvalidAccountName, UnknownCurrency, CurrencyMismatch",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/accounts/{accountId}/archive": {
    post: {
      operationId: "archiveAccount",
      summary: "Archive an account; its history stays, it takes no new movements",
      ...securedByUser,
      requestParams: { path: AccountPath },
      responses: {
        "200": one("The archived account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, AccountNotFound",
        }),
      },
    },
  },
};

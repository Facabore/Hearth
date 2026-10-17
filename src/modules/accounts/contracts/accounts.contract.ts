import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";
import {
  ACCOUNT_COLORS,
  ACCOUNT_ICONS,
  ACCOUNT_TYPES,
  iconOf,
  type AccountView,
  type AttributeChanges,
} from "../application";

const AccountTypeSchema = z.enum(ACCOUNT_TYPES);
// HU-E2-05: patterns and enums are refused here (ValidationFailed), so nothing invalid is ever stored.
const Institution = z.string().trim().min(1).max(60);
const LastFour = z.string().regex(/^\d{4}$/, { error: "Exactly the last four digits" });
const Color = z.enum(ACCOUNT_COLORS);
const Icon = z.enum(ACCOUNT_ICONS);

export const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: AccountTypeSchema,
  ownerUserId: z.string().nullable(),
  openingBalance: MoneySchema,
  /** Opening balance plus ledger movements, computed on read (HU-E2-04). */
  balance: MoneySchema,
  archivedAt: z.iso.datetime().nullable(),
  institution: z.string().nullable(),
  lastFour: z.string().nullable(),
  color: Color.nullable(),
  /** The icon shown: the chosen one, else the type's default. */
  icon: Icon,
});

export const CreateAccountBodySchema = z.object({
  name: z.string().max(200),
  type: AccountTypeSchema,
  openingBalance: MoneySchema,
  institution: Institution.optional(),
  lastFour: LastFour.optional(),
  color: Color.optional(),
  icon: Icon.optional(),
});
/** HU-E2-05: `null` clears an attribute (the icon goes back to the type's default). */
export const UpdateAccountBodySchema = z.object({
  name: z.string().max(200).optional(),
  type: AccountTypeSchema.optional(),
  openingBalance: MoneySchema.optional(),
  institution: Institution.nullable().optional(),
  lastFour: LastFour.nullable().optional(),
  color: Color.nullable().optional(),
  icon: Icon.nullable().optional(),
});

/** HU-E2-05: the common attributes of a create or update body. */
export const attributesFromBody = (
  body: Pick<z.infer<typeof UpdateAccountBodySchema>, "institution" | "lastFour" | "color" | "icon">,
): AttributeChanges => ({
  institution: body.institution,
  lastFour: body.lastFour,
  color: body.color,
  icon: body.icon,
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
  institution: view.institution,
  lastFour: view.lastFour,
  color: view.color,
  icon: iconOf(view),
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
          "409":
            "AccountNameTaken, SharedFundRequiresSharedSpace, PersonalAccountRequiresPersonalSpace, SpaceArchived",
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
      summary:
        "Rename an account, correct its opening balance, or change its institution, last four digits, color or icon (the type never changes)",
      ...securedByUser,
      requestParams: { path: AccountPath },
      requestBody: { content: jsonContent(UpdateAccountBodySchema) },
      responses: {
        "200": one("The updated account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, AccountNotFound",
          "409": "AccountNameTaken, AccountTypeImmutable, SpaceArchived",
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
          "409": "SpaceArchived",
        }),
      },
    },
  },
};

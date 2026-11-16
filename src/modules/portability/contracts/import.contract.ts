import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import {
  IdSchema,
  jsonContent,
  MoneySchema,
  moneyToDto,
  problems,
  securedByUser,
} from "@/shared/http/contracts";
import type {
  ImportAccountView,
  ImportCategoryView,
  ImportResult,
  ImportSummary,
  ImportView,
  UndoneImport,
} from "../application";

const ACCOUNT_TYPES = [
  "CASH",
  "BANK",
  "WALLET",
  "CREDIT_CARD",
  "SAVINGS",
  "INVESTMENT",
  "LOAN",
  "OTHER",
] as const;

const AccountMappingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), accountId: IdSchema }),
  z.object({
    kind: z.literal("new"),
    type: z.enum(ACCOUNT_TYPES),
    currency: z.string().regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" }),
  }),
]);

const CategoryMappingSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("existing"), categoryId: IdSchema }),
  z.object({
    kind: z.literal("new"),
    groupId: IdSchema.nullable().describe(
      "The group a new top-level category goes in; ignored for a subcategory, which goes under what its parent maps to.",
    ),
  }),
]);

const SourceKeySchema = z.string().min(1).max(200);

/** Design §3.2: the person's changes to a draft; each one left out keeps what the draft has. */
export const AdjustImportBodySchema = z
  .object({
    timeZone: z.string().min(1).max(64).optional(),
    accounts: z.record(SourceKeySchema, AccountMappingSchema).optional(),
    categories: z.record(SourceKeySchema, CategoryMappingSchema).optional(),
    includeDuplicates: z
      .array(SourceKeySchema)
      .max(100_000)
      .optional()
      .describe("Every likely duplicate to import anyway; replaces the list the draft has."),
  })
  .strict();

const IssueSchema = z.object({
  code: z.string(),
  sourceKey: z.string(),
  details: z.record(z.string(), z.string()).optional(),
});

const CountsSchema = z.object({
  accountsCreated: z.number().int(),
  categoriesCreated: z.number().int(),
  movementsImported: z.number().int(),
  alreadyImported: z.number().int(),
  duplicatesSkipped: z.number().int(),
  adjustmentsInOpeningBalance: z.number().int(),
  adjustmentsNotImported: z
    .number()
    .int()
    .describe(
      "Balance adjustments after their account's first movement: not imported yet (the ADJUSTMENT type, Q4).",
    ),
  rowErrors: z.number().int(),
});

const STATUS = z.enum(["DRAFT", "CONFIRMED", "UNDONE"]);

export const ImportPreviewSchema = z
  .object({
    id: z.string(),
    status: STATUS,
    sourceApp: z.string(),
    createdAt: z.iso.datetime(),
    previouslyImportedAt: z.iso
      .datetime()
      .nullable()
      .describe(
        "When a confirmed import of the same file (same SHA-256) last ran in this space; null for a new file.",
      ),
    timeZone: z.string(),
    counts: z.object({
      income: z.number().int(),
      expense: z.number().int(),
      transfer: z.number().int(),
      adjustment: z.number().int(),
      total: z.number().int(),
      skippedZero: z.number().int(),
    }),
    dateRange: z.object({ first: z.iso.date(), last: z.iso.date() }).nullable(),
    accounts: z.array(
      z.object({
        sourceId: z.string(),
        name: z.string(),
        type: z.enum(ACCOUNT_TYPES),
        currency: z.string(),
        cutOffDay: z.number().int().nullable(),
        paymentDay: z.number().int().nullable(),
        sourceClosingBalance: MoneySchema,
        mapping: AccountMappingSchema,
      }),
    ),
    categories: z.array(
      z.object({
        sourceId: z.string(),
        name: z.string(),
        icon: z.string().nullable(),
        kind: z.enum(["INCOME", "EXPENSE"]),
        parentSourceId: z.string().nullable(),
        archived: z.boolean(),
        catalogKey: z.string().nullable(),
        mapping: CategoryMappingSchema,
      }),
    ),
    duplicates: z
      .array(z.string())
      .describe("Source keys of likely duplicates of movements already in Hearth."),
    includeDuplicates: z.array(z.string()),
    plan: z.object({
      movements: z.number().int(),
      alreadyImported: z.array(z.string()),
      duplicatesSkipped: z.number().int(),
      adjustmentsInOpeningBalance: z.number().int(),
      adjustmentsNotImported: z.number().int(),
    }),
    leftOut: z.object({ budgets: z.number().int(), zeroAmountMovements: z.number().int() }),
    warnings: z.array(IssueSchema),
    errors: z.array(IssueSchema),
  })
  .describe("An upload's dry run (design §3.2): nothing reached the ledger yet.");

export const ImportResultSchema = z.object({
  id: z.string(),
  status: STATUS,
  counts: CountsSchema.nullable(),
  rowErrors: z.array(IssueSchema).describe("Rows the ledger refused, with its code; the rest was imported."),
});

export const UndoneImportSchema = z.object({
  id: z.string(),
  status: z.literal("UNDONE"),
  movementsDeleted: z.number().int(),
  accountsArchived: z.number().int(),
  categoriesArchived: z.number().int(),
});

export const ImportHistorySchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      sourceApp: z.string(),
      status: STATUS,
      createdAt: z.iso.datetime(),
      confirmedAt: z.iso.datetime().nullable(),
      undoneAt: z.iso.datetime().nullable(),
      counts: CountsSchema.nullable(),
    }),
  ),
});

const iso = (date: Date | null) => (date === null ? null : date.toISOString());

const accountDto = (a: ImportAccountView) => ({
  ...a,
  sourceClosingBalance: moneyToDto(a.sourceClosingBalance),
});
const categoryDto = (c: ImportCategoryView) => ({ ...c });

export const importPreviewDto = (view: ImportView): z.infer<typeof ImportPreviewSchema> =>
  ({
    ...view,
    createdAt: view.createdAt.toISOString(),
    previouslyImportedAt: iso(view.previouslyImportedAt),
    accounts: view.accounts.map(accountDto),
    categories: view.categories.map(categoryDto),
  }) as z.infer<typeof ImportPreviewSchema>;

export const importResultDto = (result: ImportResult): z.infer<typeof ImportResultSchema> =>
  result as z.infer<typeof ImportResultSchema>;

export const importHistoryDto = (items: readonly ImportSummary[]): z.infer<typeof ImportHistorySchema> => ({
  items: items.map((i) => ({
    ...i,
    createdAt: i.createdAt.toISOString(),
    confirmedAt: iso(i.confirmedAt),
    undoneAt: iso(i.undoneAt),
  })),
});

export const undoneImportDto = (undone: UndoneImport): z.infer<typeof UndoneImportSchema> => undone;

/** The multipart field the upload reads, and an optional source app (only Money Manager for now). */
export const UploadFieldsSchema = z.object({
  file: z.string().meta({ format: "binary" }).describe("The backup, at most 20 MB; never stored."),
  source: z.enum(["money-manager"]).optional(),
});

const SpacePath = z.object({ spaceId: z.string() });
const ImportPath = SpacePath.extend({ importId: z.string() });
const IdempotencyHeader = z.object({ "idempotency-key": z.string().max(255).optional() });

const BASE = {
  "401": "Unauthenticated",
  "403": "InsufficientRole",
};

export const importPaths: ZodOpenApiPathsObject = {
  "/api/v1/spaces/{spaceId}/imports": {
    post: {
      operationId: "startImport",
      summary: "Upload another app's backup and get its preview",
      description:
        "Reads a Money Manager SQLite backup (multipart field `file`, at most 20 MB) in memory, off the server's thread, for at most 30 seconds, and stores a draft with its hash and what was read; the file is never stored. Nothing reaches the ledger. Only a member who records money, in their personal space.",
      ...securedByUser,
      requestParams: { path: SpacePath },
      requestBody: { content: { "multipart/form-data": { schema: UploadFieldsSchema } } },
      responses: {
        "201": { description: "The draft's preview", content: jsonContent(ImportPreviewSchema) },
        ...problems({
          ...BASE,
          "404": "SpaceNotFound",
          "409": "ImportRequiresPersonalSpace, SpaceArchived",
          "422":
            "ValidationFailed, ImportFileTooLarge, ImportFileNotRecognized, UnreadableBackup, ZipBackupNotSupported, ImportTimedOut",
        }),
      },
    },
    get: {
      operationId: "listImports",
      summary: "The space's past imports, newest first, with their counts and undo state",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": { description: "The history", content: jsonContent(ImportHistorySchema) },
        ...problems({ ...BASE, "404": "SpaceNotFound", "409": "ImportRequiresPersonalSpace" }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/imports/{importId}": {
    patch: {
      operationId: "adjustImport",
      summary: "Change a draft's mappings, time zone or included duplicates, and get its new preview",
      description:
        "An account maps to one of the caller's live accounts in the space, or to a new account of a type, in the source account's own currency. A category maps to a live category, or to a new one in a group (a subcategory goes under what its parent maps to).",
      ...securedByUser,
      requestParams: { path: ImportPath },
      requestBody: { content: jsonContent(AdjustImportBodySchema) },
      responses: {
        "200": { description: "The draft's new preview", content: jsonContent(ImportPreviewSchema) },
        ...problems({
          ...BASE,
          "404": "SpaceNotFound, ImportNotFound",
          "409": "ImportNotDraft, ImportSnapshotExpired, ImportRequiresPersonalSpace, SpaceArchived",
          "422": "ValidationFailed, InvalidImportMapping, InvalidTimeZone",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/imports/{importId}/confirm": {
    post: {
      operationId: "confirmImport",
      summary: "Import a draft into the ledger, in one transaction",
      description:
        "Creates the new accounts and categories and records every movement through the ledger's own rules, keeping each one's date and, when the file has it, its time. What an earlier import brought is skipped, even if it was edited or deleted since. A movement the ledger refuses (no exchange rate for its date, a closed period) is listed in `rowErrors` and the rest is imported. Balance adjustments on or before their account's first movement become its opening balance; later ones are counted as not imported yet.",
      ...securedByUser,
      requestParams: { path: ImportPath, header: IdempotencyHeader },
      responses: {
        "200": { description: "What the import did", content: jsonContent(ImportResultSchema) },
        ...problems({
          ...BASE,
          "404": "SpaceNotFound, ImportNotFound",
          "409":
            "ImportNotDraft, ImportSnapshotExpired, ImportRequiresPersonalSpace, SpaceArchived, AccountNameTaken, CategoryNameTaken, IdempotencyKeyConflict",
          "422": "InvalidImportMapping, InvalidIdempotencyKey",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/imports/{importId}/undo": {
    post: {
      operationId: "undoImport",
      summary: "Undo a confirmed import",
      description:
        "Deletes logically every movement the import created and archives the accounts and categories it created that nothing else uses. Importing the same file again afterwards brings everything back.",
      ...securedByUser,
      requestParams: { path: ImportPath },
      responses: {
        "200": { description: "What the undo did", content: jsonContent(UndoneImportSchema) },
        ...problems({
          ...BASE,
          "404": "SpaceNotFound, ImportNotFound",
          "409": "ImportNotConfirmed, PeriodClosed, ImportRequiresPersonalSpace, SpaceArchived",
        }),
      },
    },
  },
};

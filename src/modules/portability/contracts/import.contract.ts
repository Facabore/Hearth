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
  SourceIssue,
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

const CURRENCY = z.string().regex(/^[A-Z]{3}$/, { error: "Currency must be an ISO 4217 code" });
const NAME = z.string().trim().min(1).max(60);

const ExistingAccountSchema = z.object({ kind: z.literal("existing"), accountId: IdSchema });
const ExistingCategorySchema = z.object({ kind: z.literal("existing"), categoryId: IdSchema });
const GROUP_ID = IdSchema.nullable().describe(
  "The group a new top-level category goes in; null for the import's own group (found or created at confirm). Ignored for a subcategory, which goes under what its parent maps to.",
);

/** A mapping as the person sends it: a new record's name is optional, the source's by default. */
const AccountMappingInputSchema = z.discriminatedUnion("kind", [
  ExistingAccountSchema,
  z.object({
    kind: z.literal("new"),
    type: z.enum(ACCOUNT_TYPES),
    currency: CURRENCY,
    name: NAME.optional(),
  }),
]);
const CategoryMappingInputSchema = z.discriminatedUnion("kind", [
  ExistingCategorySchema,
  z.object({ kind: z.literal("new"), groupId: GROUP_ID, name: NAME.optional() }),
]);

/**
 * A mapping as the preview answers it: a new record's `name` is the one the confirm will use, which no record of its
 * scope holds (archived ones included); it differs from the source's name when that one is taken.
 */
const AccountMappingSchema = z.discriminatedUnion("kind", [
  ExistingAccountSchema,
  z.object({ kind: z.literal("new"), type: z.enum(ACCOUNT_TYPES), currency: CURRENCY, name: z.string() }),
]);
const CategoryMappingSchema = z.discriminatedUnion("kind", [
  ExistingCategorySchema,
  z.object({
    kind: z.literal("new"),
    groupId: GROUP_ID,
    name: z
      .string()
      .optional()
      .describe("Absent only for a subcategory that merges into what its parent maps to."),
  }),
]);

const SourceKeySchema = z.string().min(1).max(200);

/** Design §3.2: the person's changes to a draft; each one left out keeps what the draft has. */
export const AdjustImportBodySchema = z
  .object({
    timeZone: z.string().min(1).max(64).optional(),
    accounts: z.record(SourceKeySchema, AccountMappingInputSchema).optional(),
    categories: z.record(SourceKeySchema, CategoryMappingInputSchema).optional(),
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
  accountsRestored: z
    .number()
    .int()
    .describe("Accounts an undone import of the same source created, restored instead of created again."),
  categoriesCreated: z.number().int(),
  categoriesRestored: z.number().int(),
  movementsImported: z.number().int(),
  alreadyImported: z.number().int(),
  duplicatesSkipped: z.number().int(),
  adjustmentsInOpeningBalance: z.number().int(),
  adjustmentsNotImported: z
    .number()
    .int()
    .describe(
      "Balance adjustments the ledger refused to record as ADJUSTMENT movements (they are also in rowErrors); 0 in a preview.",
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

type PreviewDto = z.infer<typeof ImportPreviewSchema>;
type MappingDto<T> = T extends { readonly kind: "new" } ? T & { readonly name: string } : T;

/** Every new mapping the view answers was settled by `checkMappings` or the proposals, so it carries its name. */
const named = <T extends { readonly kind: string; readonly name?: string }>(mapping: T, fallback: string) =>
  (mapping.kind === "new" ? { ...mapping, name: mapping.name ?? fallback } : mapping) as MappingDto<T>;

const accountDto = (a: ImportAccountView): PreviewDto["accounts"][number] => ({
  sourceId: a.sourceId,
  name: a.name,
  type: a.type,
  currency: a.currency,
  cutOffDay: a.cutOffDay,
  paymentDay: a.paymentDay,
  sourceClosingBalance: moneyToDto(a.sourceClosingBalance),
  mapping: named(a.mapping, a.name),
});

const categoryDto = (c: ImportCategoryView): PreviewDto["categories"][number] => ({
  sourceId: c.sourceId,
  name: c.name,
  icon: c.icon,
  kind: c.kind,
  parentSourceId: c.parentSourceId,
  archived: c.archived,
  catalogKey: c.catalogKey,
  mapping: c.mapping,
});

const issueDto = (issue: SourceIssue) => ({
  code: issue.code,
  sourceKey: issue.sourceKey,
  ...(issue.details === undefined ? {} : { details: { ...issue.details } }),
});

export const importPreviewDto = (view: ImportView): PreviewDto => ({
  id: view.id,
  status: view.status,
  sourceApp: view.sourceApp,
  createdAt: view.createdAt.toISOString(),
  previouslyImportedAt: iso(view.previouslyImportedAt),
  timeZone: view.timeZone,
  counts: { ...view.counts },
  dateRange: view.dateRange === null ? null : { first: view.dateRange.first, last: view.dateRange.last },
  accounts: view.accounts.map(accountDto),
  categories: view.categories.map(categoryDto),
  duplicates: [...view.duplicates],
  includeDuplicates: [...view.includeDuplicates],
  plan: { ...view.plan, alreadyImported: [...view.plan.alreadyImported] },
  leftOut: { ...view.leftOut },
  warnings: view.warnings.map(issueDto),
  errors: view.errors.map(issueDto),
});

export const importResultDto = (result: ImportResult): z.infer<typeof ImportResultSchema> => ({
  id: result.id,
  status: result.status,
  counts: result.counts === null ? null : { ...result.counts },
  rowErrors: result.rowErrors.map(issueDto),
});

export const importHistoryDto = (items: readonly ImportSummary[]): z.infer<typeof ImportHistorySchema> => ({
  items: items.map((i) => ({
    id: i.id,
    sourceApp: i.sourceApp,
    status: i.status,
    createdAt: i.createdAt.toISOString(),
    confirmedAt: iso(i.confirmedAt),
    undoneAt: iso(i.undoneAt),
    counts: i.counts === null ? null : { ...i.counts },
  })),
});

export const undoneImportDto = (undone: UndoneImport): z.infer<typeof UndoneImportSchema> => ({ ...undone });

/**
 * The multipart field the upload reads, and an optional source app. The app is detected from the file itself; `source`
 * only refuses an upload that names an app this server does not read (only Money Manager for now).
 */
export const UploadFieldsSchema = z.object({
  file: z.string().meta({ format: "binary" }).describe("The backup, at most 20 MB; never stored."),
  source: z.enum(["money-manager"]).optional().describe("Optional: the app is detected from the file."),
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
        "Reads a Money Manager SQLite backup (multipart field `file`, at most 20 MB) in memory, off the server's thread, for at most 30 seconds (a server reads a few uploads at once; one more answers 429 TooManyRequests), and stores a draft with its hash and what was read; the file is never stored. Nothing reaches the ledger. Only a member who records money, in their personal space.",
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
          "429": "TooManyRequests",
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
        "Creates the new accounts and categories and records every movement through the ledger's own rules, keeping each one's date and, when the file has it, its time. What an earlier import brought is skipped, even if it was edited or deleted since. A movement the ledger refuses (no exchange rate for its date, a closed period) is listed in `rowErrors` and the rest is imported. Balance adjustments on or before a new account's first movement become its opening balance; later ones, and any on an existing account, are recorded as ADJUSTMENT movements.",
      ...securedByUser,
      requestParams: { path: ImportPath, header: IdempotencyHeader },
      responses: {
        "200": { description: "What the import did", content: jsonContent(ImportResultSchema) },
        ...problems({
          ...BASE,
          "404": "SpaceNotFound, ImportNotFound",
          "409":
            "ImportNotDraft, ImportSnapshotExpired, ImportRequiresPersonalSpace, ImportTargetRefused, SpaceArchived, IdempotencyKeyConflict",
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

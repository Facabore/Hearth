import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, problems, securedByUser } from "@/shared/http/contracts";

/** Design §3.6: `format=json|csv` (JSON when absent) and, optionally, one of the caller's own spaces. */
export const ExportQuerySchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  spaceId: z
    .string()
    .min(1)
    .max(64)
    .optional()
    .describe("Only this space, one of the caller's current spaces; any other id answers 404 SpaceNotFound."),
});

const PolicySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("MONTHLY"), day: z.number().int() }),
  z.object({ kind: z.literal("SEMI_MONTHLY"), day1: z.number().int(), day2: z.number().int() }),
]);

const MemberRefSchema = z
  .object({ memberId: z.string(), name: z.string().nullable() })
  .describe(
    "A member by display name, a member who left the space included (D15); the name is null only for an id the space never had.",
  );

const AccountRefSchema = z
  .object({ id: z.string(), name: z.string() })
  .nullable()
  .describe(
    "One of the caller's own accounts or the space's shared fund; null for any other account, such as another member's personal account (D9).",
  );

const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string().nullable(),
  archived: z.boolean(),
});

const MovementSchema = z.object({
  id: z.string(),
  type: z.enum(["EXPENSE", "INCOME", "TRANSFER", "SETTLEMENT"]),
  date: z.iso.date(),
  time: z.string().nullable().describe("HH:MM on the recorder's clock; null without a time."),
  timeZone: z.string().nullable(),
  occurredAt: z.iso.datetime().nullable(),
  description: z.string(),
  category: z
    .object({ id: z.string(), name: z.string(), group: z.string(), parent: z.string().nullable() })
    .nullable(),
  amount: MoneySchema,
  payments: z.array(
    z.object({ member: MemberRefSchema.nullable(), account: AccountRefSchema, amount: MoneySchema }),
  ),
  shares: z.array(z.object({ member: MemberRefSchema, amount: MoneySchema, splitMethod: z.string() })),
  payer: MemberRefSchema.nullable(),
  receiver: MemberRefSchema.nullable(),
  sourceAccount: AccountRefSchema,
  destinationAccount: AccountRefSchema,
  settlementReason: z.string().nullable(),
});

const ExportedSpaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["PERSONAL", "SHARED", "DIRECT"]),
  currency: z.string(),
  periodPolicy: PolicySchema,
  role: z.string().nullable(),
  archived: z.boolean(),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.string().nullable(),
      guest: z.boolean(),
      you: z.boolean(),
    }),
  ),
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.string(),
      currency: z.string(),
      openingBalance: MoneySchema,
      terms: z.object({
        creditLimit: MoneySchema.nullable(),
        cutOffDay: z.number().int().nullable(),
        paymentDay: z.number().int().nullable(),
        monthlyRatePpm: z.number().int().nullable(),
        annualRatePpm: z.number().int().nullable(),
        termDays: z.number().int().nullable(),
        maturityDate: z.iso.date().nullable(),
        principal: MoneySchema.nullable(),
        termMonths: z.number().int().nullable(),
      }),
      archived: z.boolean(),
    }),
  ),
  categoryGroups: z.array(
    CategorySchema.extend({
      categories: z.array(CategorySchema.extend({ subcategories: z.array(CategorySchema) })),
    }),
  ),
  movements: z.array(MovementSchema),
  recurrences: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      description: z.string(),
      amount: MoneySchema,
      mode: z.string(),
      schedule: PolicySchema,
      startDate: z.iso.date(),
      endDate: z.iso.date().nullable(),
      status: z.string(),
      nextOccurrence: z.iso.date().nullable(),
      categoryId: z.string().nullable(),
      payer: MemberRefSchema.nullable(),
      sourceAccount: AccountRefSchema,
      destinationAccount: AccountRefSchema,
    }),
  ),
  plans: z.array(
    z.object({
      id: z.string(),
      period: z.object({ label: z.string(), startDate: z.iso.date(), endDate: z.iso.date() }),
      status: z.string(),
      lines: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          plannedAmount: MoneySchema,
          funding: z.string(),
          rolloverMode: z.string(),
          isCatchAll: z.boolean(),
          allocationRule: z.string(),
          categoryIds: z.array(z.string()),
          payers: z.array(MemberRefSchema),
        }),
      ),
    }),
  ),
});

/** Design §3.6: Hearth's JSON export, version 1. */
export const ExportDocumentSchema = z
  .object({
    format: z.literal("hearth-export"),
    version: z.literal(1),
    exportedAt: z.iso.datetime(),
    person: z.object({ name: z.string(), locale: z.string(), timeZone: z.string() }),
    spaces: z.array(ExportedSpaceSchema),
  })
  .describe("Hearth's JSON export, version 1; also an import source (design §3.4).");

/** `Content-Disposition` of an export, with the file name dated in the person's zone. */
export const attachment = (filename: string): readonly [string, string] => [
  "content-disposition",
  `attachment; filename="${filename}"`,
];

export const exportPaths: ZodOpenApiPathsObject = {
  "/api/v1/me/export": {
    get: {
      operationId: "exportMyData",
      summary: "Everything the caller can see in Hearth, as JSON or as a ZIP of CSV files",
      description:
        "The caller's personal space and every shared or direct space they currently belong to, or only `spaceId`. Another member's personal account never appears: a payment from it shows only the member's name (D9). Amounts are minor-unit strings with their currency in JSON and plain decimals with a dot in CSV. The CSV ZIP holds movements.csv, accounts.csv and categories.csv, UTF-8 with a BOM. Each person may export a few times per minute (429 TooManyRequests).",
      ...securedByUser,
      requestParams: { query: ExportQuerySchema },
      responses: {
        "200": {
          description:
            "An attachment named hearth-export-YYYY-MM-DD.json or .zip, dated in the caller's time zone",
          content: {
            ...jsonContent(ExportDocumentSchema),
            "application/zip": { schema: z.string().meta({ format: "binary" }) },
          },
        },
        ...problems({
          "401": "Unauthenticated",
          "404": "SpaceNotFound",
          "422": "ValidationFailed",
          "429": "TooManyRequests",
        }),
      },
    },
  },
};

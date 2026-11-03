import { createDocument, type ZodOpenApiObject } from "zod-openapi";
import { AccountSchema, accountsPaths } from "@/modules/accounts/contracts/accounts.contract";
import { balancesPaths } from "@/modules/balances/contracts/balances.contract";
import { BudgetPlanSchema, budgetingPaths } from "@/modules/budgeting/contracts/budgeting.contract";
import {
  categoriesPaths,
  CategoryGroupSchema,
  CategoryGroupSummarySchema,
  CategorySchema,
} from "@/modules/categories/contracts/categories.contract";
import { authPaths } from "@/modules/identity/contracts/auth.contract";
import { mePaths } from "@/modules/identity/contracts/me.contract";
import {
  ConvertedTransactionSchema,
  ledgerPaths,
  RecordedExpenseSchema,
  TransactionSchema,
} from "@/modules/ledger/contracts/ledger.contract";
import {
  DefineRecurrenceBodySchema,
  OccurrenceSchema,
  RecurrenceSchema,
  recurrencesPaths,
} from "@/modules/ledger/contracts/recurrences.contract";
import { reportingPaths } from "@/modules/reporting/contracts/reporting.contract";
import {
  ClaimPreviewSchema,
  InvitationPreviewSchema,
  InvitationSchema,
  SpaceMemberSchema,
  SpaceSummarySchema,
  spacesPaths,
} from "@/modules/spaces/contracts/spaces.contract";
import { MoneySchema, PeriodSchema, ProblemSchema } from "@/shared/http/contracts";
import { healthPaths, openApiPaths } from "@/shared/http/system.contract";

/**
 * #84 M1-5: a request's amount is held to PostgreSQL's bigint range, but an answer's balances and totals are sums of
 * such amounts and may leave it. The answers' Money (MoneyOutput) documents any integer string.
 */
const ANY_INTEGER = String.raw`^-?\d+$`;
const moneyAmount = MoneySchema.shape.amount;

const SCHEMA_REF = "#/components/schemas/";

type Document = { components?: { schemas?: Record<string, unknown> } & Record<string, unknown> } & Record<
  string,
  unknown
>;

/**
 * #84 M1-6: zod-openapi emits the input form of a component that another component nests (Category inside
 * CategoryGroup) even when no request uses it, next to the output form the answers name (CategoryOutput). A component
 * X that has an XOutput and that nothing else references is that unused input form, and the document leaves it out.
 */
export const withoutUnusedInputForms = <D extends Document>(doc: D): D => {
  const schemas = doc.components?.schemas;
  if (schemas === undefined) return doc;
  const referencedOutsideItself = (name: string) => {
    const others = Object.fromEntries(Object.entries(schemas).filter(([other]) => other !== name));
    const rest = { ...doc, components: { ...doc.components, schemas: others } };
    return JSON.stringify(rest).includes(JSON.stringify(`${SCHEMA_REF}${name}`));
  };
  const kept = Object.entries(schemas).filter(
    ([name]) => !(`${name}Output` in schemas) || referencedOutsideItself(name),
  );
  return { ...doc, components: { ...doc.components, schemas: Object.fromEntries(kept) } };
};

export const buildOpenApiDocument = (): Record<string, unknown> =>
  withoutUnusedInputForms(
    createDocument(
      {
        // zod-openapi 6 types target OAS 3.2; we emit 3.1.0 by design (ADR 0002).
        openapi: "3.1.0" as ZodOpenApiObject["openapi"],
        info: { title: "Hearth API", version: "1.0.0" },
        paths: {
          ...healthPaths,
          ...openApiPaths,
          ...mePaths,
          ...authPaths,
          ...spacesPaths,
          ...categoriesPaths,
          ...accountsPaths,
          ...ledgerPaths,
          ...recurrencesPaths,
          ...balancesPaths,
          ...budgetingPaths,
          ...reportingPaths,
        },
        components: {
          schemas: {
            Money: MoneySchema,
            Problem: ProblemSchema,
            Category: CategorySchema,
            CategoryGroup: CategoryGroupSchema,
            CategoryGroupSummary: CategoryGroupSummarySchema,
            Account: AccountSchema,
            Space: SpaceSummarySchema,
            SpaceMember: SpaceMemberSchema,
            Invitation: InvitationSchema,
            InvitationPreview: InvitationPreviewSchema,
            ClaimPreview: ClaimPreviewSchema,
            Period: PeriodSchema,
            Transaction: TransactionSchema,
            RecordedExpense: RecordedExpenseSchema,
            ConvertedTransaction: ConvertedTransactionSchema,
            RecurrenceDefinition: DefineRecurrenceBodySchema,
            BudgetPlan: BudgetPlanSchema,
            Recurrence: RecurrenceSchema,
            Occurrence: OccurrenceSchema,
          },
          securitySchemes: {
            cookieAuth: { type: "apiKey", in: "cookie", name: "hearth.session_token" },
            bearerAuth: { type: "http", scheme: "bearer" },
          },
        },
      },
      {
        override: ({ jsonSchema, zodSchema, io }) => {
          if (io === "output" && zodSchema === moneyAmount) jsonSchema.pattern = ANY_INTEGER;
        },
      },
    ) as unknown as Document,
  );

type Paths = Record<string, Record<string, unknown>>;

/** Lists "METHOD /path" for every operation added, removed or changed between two documents. */
export const changedOperations = (before: { paths?: Paths }, after: { paths?: Paths }): string[] => {
  const operations = (doc: { paths?: Paths }) =>
    Object.entries(doc.paths ?? {}).flatMap(([path, ops]) =>
      Object.keys(ops).map((method) => ({ method, path })),
    );
  const seen = new Map<string, { method: string; path: string }>();
  for (const op of [...operations(before), ...operations(after)]) seen.set(`${op.method} ${op.path}`, op);
  return [...seen.values()]
    .filter(
      ({ method, path }) =>
        JSON.stringify(before.paths?.[path]?.[method]) !== JSON.stringify(after.paths?.[path]?.[method]),
    )
    .map(({ method, path }) => `${method.toUpperCase()} ${path}`)
    .sort();
};

/**
 * Issue #114: the snapshot file's text. zod-openapi emits a component it meets before any operation at the end of
 * `components.schemas` and moves it once an operation names it, so its component schemas are written in name order:
 * a component never moves, and a snapshot diff shows only what changed.
 */
export const snapshotOf = (doc: Record<string, unknown>): string => {
  const components = doc.components as { schemas?: Record<string, unknown> } | undefined;
  const schemas = components?.schemas;
  const sorted =
    schemas === undefined
      ? doc
      : {
          ...doc,
          components: {
            ...components,
            schemas: Object.fromEntries(
              Object.entries(schemas).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
            ),
          },
        };
  return `${JSON.stringify(sorted, null, 2)}\n`;
};

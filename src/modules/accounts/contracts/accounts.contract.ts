import { z } from "zod";
import type { ZodOpenApiPathsObject } from "zod-openapi";
import { jsonContent, MoneySchema, moneyFromDto, problems, securedByUser } from "@/shared/http/contracts";
import {
  domainError,
  err,
  localDate,
  ok,
  type DomainError,
  type Err,
  type LocalDate,
  type Result,
} from "@/shared/kernel";
import {
  ACCOUNT_COLORS,
  ACCOUNT_ICONS,
  ACCOUNT_TYPES,
  defaultsOf,
  iconOf,
  percentText,
  ratePpmOf,
  switchesOf,
  type AccountList,
  type AccountView,
  type AttributeChanges,
  type TermsInput,
} from "../application";

const AccountTypeSchema = z.enum(ACCOUNT_TYPES);
// HU-E2-05: patterns and enums are refused here (ValidationFailed), so nothing invalid is ever stored.
const Institution = z.string().trim().min(1).max(60);
const LastFour = z.string().regex(/^\d{4}$/, { error: "Exactly the last four digits" });
const Color = z.enum(ACCOUNT_COLORS);
const Icon = z.enum(ACCOUNT_ICONS);
// HU-E2-06: ranges and rates are the domain's (InvalidBillingDay, InvalidRate, …); the contract only bounds sizes.
// Amounts are MoneySchema's, which already stops at the PostgreSQL bigint range (ValidationFailed, never a 500).
const Rate = z.string().min(1).max(16);
const Count = z.number().int().min(-100_000).max(100_000);
export const TermsBodySchema = z.object({
  creditLimit: MoneySchema.nullable().optional(),
  cutOffDay: Count.nullable().optional(),
  paymentDay: Count.nullable().optional(),
  monthlyRate: Rate.nullable().optional(),
  annualRate: Rate.nullable().optional(),
  termDays: Count.nullable().optional(),
  maturityDate: z.iso.date().nullable().optional(),
  principal: MoneySchema.nullable().optional(),
  termMonths: Count.nullable().optional(),
});
type TermsBody = z.infer<typeof TermsBodySchema>;

/** HU-E2-06: the body's terms as the use cases take them: rates in ppm (InvalidRate), money as Money. */
export const termsFromBody = (terms: TermsBody | undefined): Result<TermsInput | undefined> => {
  if (terms === undefined) return ok(undefined);
  const rate = (raw: string | null | undefined): Result<number | null | undefined> =>
    raw === undefined || raw === null ? ok(raw) : ratePpmOf(raw);
  const money = (dto: TermsBody["creditLimit"]) =>
    dto === undefined || dto === null ? ok(dto) : moneyFromDto(dto);
  const monthlyRatePpm = rate(terms.monthlyRate);
  if (!monthlyRatePpm.ok) return monthlyRatePpm;
  const annualRatePpm = rate(terms.annualRate);
  if (!annualRatePpm.ok) return annualRatePpm;
  const creditLimit = money(terms.creditLimit);
  if (!creditLimit.ok) return creditLimit;
  const principal = money(terms.principal);
  if (!principal.ok) return principal;
  const maturity =
    terms.maturityDate === undefined || terms.maturityDate === null
      ? ok(terms.maturityDate)
      : localDate(terms.maturityDate);
  if (!maturity.ok) return maturity;
  return ok({
    creditLimit: creditLimit.value,
    cutOffDay: terms.cutOffDay,
    paymentDay: terms.paymentDay,
    monthlyRatePpm: monthlyRatePpm.value,
    annualRatePpm: annualRatePpm.value,
    termDays: terms.termDays,
    maturityDate: maturity.value as LocalDate | null | undefined,
    principal: principal.value,
    termMonths: terms.termMonths,
  });
};

// Rates are stored in parts per million; the body names them without the unit.
const PUBLIC_TERM_NAMES: ReadonlyMap<string, string> = new Map([
  ["monthlyRatePpm", "monthlyRate"],
  ["annualRatePpm", "annualRate"],
]);

/**
 * HU-E2-06: an AccountAttributeNotAllowed names the term it refuses as the key inside the body's `terms` (`field`, for
 * example `monthlyRate`), so a form can highlight it; the stored key (`attribute`) never leaves the server. Any other
 * failure passes through.
 */
export const withPublicField = (failure: Err<DomainError>): Err<DomainError> => {
  const attribute = failure.error.details?.attribute;
  if (failure.error.code !== "AccountAttributeNotAllowed" || typeof attribute !== "string") return failure;
  return err(
    domainError(failure.error.code, {
      ...failure.error.details,
      field: PUBLIC_TERM_NAMES.get(attribute) ?? attribute,
    }),
  );
};

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
  /** HU-E2-07: whether it counts in the space's available money and net worth (the type's default unless set). */
  includeInAvailable: z.boolean(),
  includeInNetWorth: z.boolean(),
  /** Issue 120 (P253): the icon and switches as stored; null shows the type's default (what `PATCH … null` stores). */
  stored: z.object({
    icon: Icon.nullable(),
    includeInAvailable: z.boolean().nullable(),
    includeInNetWorth: z.boolean().nullable(),
  }),
  /** Issue 120 (P253): the type's defaults, which a stored null shows. */
  defaults: z.object({ icon: Icon, includeInAvailable: z.boolean(), includeInNetWorth: z.boolean() }),
  /** HU-E2-06: the type's stored terms; rates as percent strings with four decimals. */
  terms: z.object({
    creditLimit: MoneySchema.nullable(),
    cutOffDay: z.number().int().nullable(),
    paymentDay: z.number().int().nullable(),
    monthlyRate: z.string().nullable(),
    annualRate: z.string().nullable(),
    termDays: z.number().int().nullable(),
    maturityDate: z.iso.date().nullable(),
    principal: MoneySchema.nullable(),
    termMonths: z.number().int().nullable(),
  }),
  /** HU-E2-06: derived on read, today being the requester's local date. */
  derived: z.object({
    availableCredit: MoneySchema.nullable(),
    nextCutOffDate: z.iso.date().nullable(),
    nextPaymentDate: z.iso.date().nullable(),
    effectiveAnnualRate: z.string().nullable(),
    equivalentMonthlyRate: z.string().nullable(),
    startDate: z.iso.date().nullable(),
  }),
});

export const CreateAccountBodySchema = z.object({
  name: z.string().max(200),
  type: AccountTypeSchema,
  openingBalance: MoneySchema,
  institution: Institution.optional(),
  lastFour: LastFour.optional(),
  color: Color.optional(),
  icon: Icon.optional(),
  includeInAvailable: z.boolean().optional(),
  includeInNetWorth: z.boolean().optional(),
  terms: TermsBodySchema.optional(),
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
  /** null returns a switch to the type's default. */
  includeInAvailable: z.boolean().nullable().optional(),
  includeInNetWorth: z.boolean().nullable().optional(),
  terms: TermsBodySchema.optional(),
});

/** HU-E2-05: the common attributes of a create or update body. */
export const attributesFromBody = (
  body: Pick<
    z.infer<typeof UpdateAccountBodySchema>,
    "institution" | "lastFour" | "color" | "icon" | "includeInAvailable" | "includeInNetWorth"
  >,
): AttributeChanges => ({
  institution: body.institution,
  lastFour: body.lastFour,
  color: body.color,
  icon: body.icon,
  includeInAvailable: body.includeInAvailable,
  includeInNetWorth: body.includeInNetWorth,
});

export const GetAccountQuerySchema = z.object({ asOf: z.iso.date().optional() });
export const ListAccountsQuerySchema = GetAccountQuerySchema.extend({
  archived: z.enum(["true", "false"]).optional(),
});
export const ListAccountsResponseSchema = z.object({
  items: z.array(AccountSchema),
  /** HU-E2-07: over the space's active accounts at `asOf`, whatever `archived` lists. */
  totals: z.object({ available: MoneySchema, netWorth: MoneySchema }),
});

/** HU-E2-07: a list answer. */
export const accountListDto = (list: AccountList): z.infer<typeof ListAccountsResponseSchema> => ({
  items: list.items.map(accountDto),
  totals: {
    available: { amount: list.totals.available.toString(), currency: list.currency },
    netWorth: { amount: list.totals.netWorth.toString(), currency: list.currency },
  },
});

/** Issue 169: the starter accounts one call created; empty when the space already held every starter name. */
export const StarterAccountsResponseSchema = z.object({ items: z.array(AccountSchema) });
export const starterAccountsDto = (
  created: readonly AccountView[],
): z.infer<typeof StarterAccountsResponseSchema> => ({ items: created.map(accountDto) });

const amountOf = (minor: bigint | null, currency: string) =>
  minor === null ? null : { amount: minor.toString(), currency };
const rateOf = (ppm: number | null) => (ppm === null ? null : percentText(ppm));

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
  ...switchesOf(view),
  stored: {
    icon: view.icon,
    includeInAvailable: view.includeInAvailable,
    includeInNetWorth: view.includeInNetWorth,
  },
  defaults: defaultsOf(view.type),
  terms: {
    creditLimit: amountOf(view.terms.creditLimit, view.currency),
    cutOffDay: view.terms.cutOffDay,
    paymentDay: view.terms.paymentDay,
    monthlyRate: rateOf(view.terms.monthlyRatePpm),
    annualRate: rateOf(view.terms.annualRatePpm),
    termDays: view.terms.termDays,
    maturityDate: view.terms.maturityDate,
    principal: amountOf(view.terms.principal, view.currency),
    termMonths: view.terms.termMonths,
  },
  derived: {
    availableCredit: amountOf(view.figures.availableCredit, view.currency),
    nextCutOffDate: view.figures.nextCutOffDate,
    nextPaymentDate: view.figures.nextPaymentDate,
    effectiveAnnualRate: rateOf(view.figures.effectiveAnnualRatePpm),
    equivalentMonthlyRate: rateOf(view.figures.equivalentMonthlyRatePpm),
    startDate: view.figures.startDate,
  },
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
      summary: "Create an account with an opening balance and, by type, its card, savings or loan terms",
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
            "AccountNameTaken, SharedFundRequiresSharedSpace, PersonalAccountRequiresPersonalSpace, SpaceArchived, AccountAttributeNotAllowed",
          "422":
            "ValidationFailed, InvalidAccountName, UnknownCurrency, CurrencyMismatch, InvalidCreditLimit, InvalidBillingDay, InvalidRate, InvalidTermDeposit, InvalidTerm, InvalidAmount, InvalidDate",
        }),
      },
    },
  },
  "/api/v1/spaces/{spaceId}/accounts/starter": {
    post: {
      operationId: "createStarterAccounts",
      summary:
        "Create the personal space's starter accounts at zero, in the caller's language, skipping every name the space already holds (archived ones included); a second call creates nothing",
      ...securedByUser,
      requestParams: { path: SpacePath },
      responses: {
        "200": {
          description: "The starter accounts this call created; empty when none was missing",
          content: jsonContent(StarterAccountsResponseSchema),
        },
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound",
          "409": "PersonalAccountRequiresPersonalSpace, SpaceArchived",
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
        "Rename an account, correct its opening balance, or change its institution, last four digits, color, icon or its card, savings or loan terms (the type never changes)",
      ...securedByUser,
      requestParams: { path: AccountPath },
      requestBody: { content: jsonContent(UpdateAccountBodySchema) },
      responses: {
        "200": one("The updated account"),
        ...problems({
          "401": "Unauthenticated",
          "403": "InsufficientRole",
          "404": "SpaceNotFound, AccountNotFound",
          "409": "AccountNameTaken, AccountTypeImmutable, SpaceArchived, AccountAttributeNotAllowed",
          "422":
            "ValidationFailed, InvalidAccountName, UnknownCurrency, CurrencyMismatch, InvalidCreditLimit, InvalidBillingDay, InvalidRate, InvalidTermDeposit, InvalidTerm, InvalidAmount, InvalidDate",
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
  "/api/v1/spaces/{spaceId}/accounts/{accountId}/restore": {
    post: {
      operationId: "restoreAccount",
      summary: "Restore an archived account; it takes new movements again",
      ...securedByUser,
      requestParams: { path: AccountPath },
      responses: {
        "200": one("The restored account"),
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

import type {
  AccountDto,
  CategoryGroupDto,
  MeDto,
  MoneyDto,
  SpaceDto,
  TransactionDto,
} from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";

/** Pesos as the wire carries them: minor units in a string (string arithmetic is safe for test amounts). */
export const cop = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "COP" });

const RULES = {
  numberFormat: "DOT_COMMA",
  timeFormat: "H24",
  dateFormat: "DMY",
  weekStart: "MONDAY",
} as const;

/** Ana, signed in, following every installation rule. */
export const meDto = (overrides: Partial<MeDto> = {}): MeDto => ({
  id: "u-ana",
  name: "Ana",
  email: "ana@example.com",
  locale: "es",
  timezone: "America/Bogota",
  preferences: {
    stored: { numberFormat: null, timeFormat: null, dateFormat: null, weekStart: null },
    effective: { ...RULES },
    defaults: { ...RULES, timezone: "America/Bogota", locale: "es" },
    locked: [],
  },
  ...overrides,
});

/** Ana's personal space. */
export const spaceDto = (overrides: Partial<SpaceDto> = {}): SpaceDto => ({
  id: "sp-personal",
  name: "Personal",
  kind: "PERSONAL",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "OWNER",
  ...overrides,
});

/** Text with every whitespace (the formatters' non-breaking spaces) as a plain space. */
export const normalized = (text: string | null | undefined) => (text ?? "").replace(/\s/g, " ");

/** Ana after `PATCH /api/v1/me` with `body`: stored values replaced, effective ones recomputed from the rules. */
export const patchedMe = (body: Record<string, unknown>, base = meDto()) => {
  const stored = { ...base.preferences.stored, ...body };
  const effective = Object.fromEntries(
    Object.entries(base.preferences.defaults).map(([k, v]) => [
      k,
      (stored as Record<string, unknown>)[k] ?? v,
    ]),
  );
  return {
    ...base,
    preferences: { ...base.preferences, stored, effective: { ...base.preferences.effective, ...effective } },
  };
};

/** A BANK account of Ana's personal space with no attributes, no terms and zero balances. */
export const accountDto = (overrides: Partial<AccountDto> = {}): AccountDto => ({
  id: "a-1",
  name: "Cuenta",
  type: "BANK",
  ownerUserId: "u-ana",
  openingBalance: cop(0),
  balance: cop(0),
  archivedAt: null,
  institution: null,
  lastFour: null,
  color: null,
  icon: "bank",
  includeInAvailable: true,
  includeInNetWorth: true,
  terms: {
    creditLimit: null,
    cutOffDay: null,
    paymentDay: null,
    monthlyRate: null,
    annualRate: null,
    termDays: null,
    maturityDate: null,
    principal: null,
    termMonths: null,
  },
  derived: {
    availableCredit: null,
    nextCutOffDate: null,
    nextPaymentDate: null,
    effectiveAnnualRate: null,
    equivalentMonthlyRate: null,
    startDate: null,
  },
  ...overrides,
});

type CategoryNode = CategoryGroupDto["categories"][number];

/** A live category of the "Food" group with a symbol, no subcategories. */
export const categoryDto = (overrides: Partial<CategoryNode> = {}): CategoryNode => ({
  id: "c-1",
  groupId: "g-food",
  parentCategoryId: null,
  name: "Categoría",
  key: null,
  archivedAt: null,
  icon: { kind: "SYMBOL", name: "cart" },
  color: "SAGE",
  subcategories: [],
  ...overrides,
});

/** A live group with no categories. */
export const groupDto = (overrides: Partial<CategoryGroupDto> = {}): CategoryGroupDto => ({
  id: "g-food",
  name: "Food",
  key: "food",
  archivedAt: null,
  icon: { kind: "SYMBOL", name: "fork" },
  color: "SAGE",
  categories: [],
  ...overrides,
});

/** An untimed EXPENSE of nothing on 2026-10-01, with no category, payments, shares or accounts. */
export const transactionDto = (overrides: Partial<TransactionDto> = {}): TransactionDto => ({
  id: "t-1",
  type: "EXPENSE",
  description: "Item",
  date: "2026-10-01",
  occurredAt: null,
  timeZone: null,
  amount: cop(0),
  categoryId: null,
  payments: [],
  shares: [],
  sourceAccountId: null,
  destinationAccountId: null,
  receivingMemberId: null,
  payerMemberId: null,
  createdBy: "u-ana",
  createdAt: "2026-10-01T12:00:00.000Z",
  updatedAt: "2026-10-01T12:00:00.000Z",
  version: 1,
  ...overrides,
});

const octoberGroups = [
  groupDto({
    id: "g-food",
    name: "Food",
    categories: [
      categoryDto({
        id: "c-groceries",
        name: "Groceries",
        subcategories: [categoryDto({ id: "c-veg", name: "Vegetables", parentCategoryId: "c-groceries" })],
      }),
      categoryDto({ id: "c-dining", name: "Restaurants" }),
    ],
  }),
  groupDto({ id: "g-income", name: "Income", categories: [categoryDto({ id: "c-salary", name: "Wages" })] }),
];
/** The story's October 2026 viewer: Bogotá, the built-in formats, two named accounts. */
export const rowContext = {
  formats: BUILT_IN_FORMATS,
  viewerZone: "America/Bogota",
  groups: octoberGroups,
  accountNames: { "a-bank": "Bancolombia", "a-visa": "Visa" },
};
/** An expense paid from Bancolombia, timed in Bogotá when `at` is set. */
export const octoberExpense = (
  id: string,
  description: string,
  pesos: number,
  date: string,
  at: string | null,
  categoryId: string,
) =>
  transactionDto({
    id,
    type: "EXPENSE",
    description,
    amount: cop(pesos),
    date,
    categoryId,
    occurredAt: at,
    timeZone: at ? "America/Bogota" : null,
    payments: [{ memberId: "m-ana", accountId: "a-bank", amount: cop(pesos) }],
  });
/** HU-E9-03's October 2026 page: a salary, a dinner and two market runs. */
export const octoberPage = {
  period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
  totals: { expenses: cop(245_000), income: cop(3_200_000) },
  items: [
    transactionDto({
      id: "t-salary",
      type: "INCOME",
      description: "Salary",
      amount: cop(3_200_000),
      date: "2026-10-25",
      categoryId: "c-salary",
      destinationAccountId: "a-bank",
    }),
    octoberExpense("t-dinner", "Dinner", 60_000, "2026-10-12", "2026-10-13T01:45:00.000Z", "c-dining"),
    octoberExpense("t-market2", "Market", 100_000, "2026-10-12", "2026-10-12T23:02:00.000Z", "c-veg"),
    octoberExpense("t-market1", "Market", 85_000, "2026-10-05", "2026-10-05T13:10:00.000Z", "c-groceries"),
  ],
  nextCursor: null,
};

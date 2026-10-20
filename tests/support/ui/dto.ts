import type {
  AccountDto,
  CategoryGroupDto,
  MeDto,
  MoneyDto,
  SpaceDto,
  TransactionDto,
} from "@/shared/ui/api/dto";

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

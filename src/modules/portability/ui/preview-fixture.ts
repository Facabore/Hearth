import type { ImportPreviewDto, ImportResultDto, ImportSummaryDto } from "./dto";

// Test data for this module's screens and the single-page app's import flow: a Money Manager draft as the API answers
// it, shaped like board 3's example. Nothing in the app imports it.

export const previewFixture = (overrides: Partial<ImportPreviewDto> = {}): ImportPreviewDto => ({
  id: "imp-1",
  status: "DRAFT",
  sourceApp: "money-manager",
  createdAt: "2026-11-15T15:00:00.000Z",
  previouslyImportedAt: null,
  timeZone: "America/Bogota",
  counts: { income: 104, expense: 830, transfer: 300, adjustment: 6, total: 1240, skippedZero: 0 },
  dateRange: { first: "2025-05-06", last: "2026-11-13" },
  accounts: [
    {
      sourceId: "a-1",
      name: "Ahorros Bancolombia",
      type: "SAVINGS",
      currency: "COP",
      cutOffDay: null,
      paymentDay: null,
      sourceClosingBalance: { amount: "146960000", currency: "COP" },
      hidden: false,
      movementCount: 640,
      suggested: "ACCOUNT",
      options: {
        account: { kind: "existing", accountId: "acc-bancolombia" },
        person: { kind: "person", name: "Ahorros Bancolombia" },
        archive: { kind: "archive", accountId: "acc-bancolombia", type: "SAVINGS", currency: "COP" },
      },
      duplicateOf: null,
      mapping: { kind: "existing", accountId: "acc-bancolombia" },
    },
    {
      sourceId: "a-2",
      name: "Visa Oro",
      type: "CREDIT_CARD",
      currency: "COP",
      cutOffDay: 15,
      paymentDay: 30,
      sourceClosingBalance: { amount: "-50000000", currency: "COP" },
      hidden: false,
      movementCount: 310,
      suggested: "ACCOUNT",
      options: {
        account: { kind: "new", type: "CREDIT_CARD", currency: "COP" },
        person: { kind: "person", name: "Visa Oro" },
        archive: { kind: "archive", accountId: null, type: "CREDIT_CARD", currency: "COP" },
      },
      duplicateOf: null,
      mapping: { kind: "new", type: "CREDIT_CARD", currency: "COP", name: "Visa Oro" },
    },
    {
      sourceId: "a-3",
      name: "Cuenta en dólares",
      type: "BANK",
      currency: "USD",
      cutOffDay: null,
      paymentDay: null,
      sourceClosingBalance: { amount: "51240", currency: "USD" },
      hidden: false,
      movementCount: 40,
      suggested: "ACCOUNT",
      options: {
        account: { kind: "new", type: "BANK", currency: "USD" },
        person: { kind: "person", name: "Cuenta en dólares" },
        archive: { kind: "archive", accountId: null, type: "BANK", currency: "USD" },
      },
      duplicateOf: null,
      // The person already has an account of this name: the confirm will use a free one.
      mapping: { kind: "new", type: "BANK", currency: "USD", name: "Cuenta en dólares (Money Manager)" },
    },
  ],
  // P337, board 4: each top-level category a group, its subcategories its categories; Salary lands on a group the
  // person has, and nothing of Hearth's is used but Mercado.
  categories: {
    groups: [
      {
        name: "Food",
        icon: "🍜",
        target: "new",
        categories: [
          { sourceId: "c-lunch", name: "Lunch", icon: "🍜", target: "new" },
          { sourceId: "c-delivery", name: "Domicilio", icon: "🍜", target: "new" },
        ],
      },
      {
        name: "Pets",
        icon: "🐶",
        target: "new",
        categories: [{ sourceId: "c-pets", name: "Pets", icon: "🐶", target: "new" }],
      },
      {
        name: "Salary",
        icon: "💰",
        target: "existing",
        categories: [{ sourceId: "c-salary", name: "Salary", icon: "💰", target: "existing" }],
      },
    ],
    archiveUnusedCategories: true,
    unusedSeeded: {
      groups: [
        { id: "grp-vivienda", name: "Vivienda" },
        { id: "grp-alimentacion", name: "Alimentación" },
        { id: "grp-salud", name: "Salud" },
      ],
      categories: [],
    },
  },
  duplicates: ["m-7", "m-8", "m-9"],
  includeDuplicates: [],
  plan: {
    movements: 1237,
    alreadyImported: [],
    duplicatesSkipped: 3,
    adjustmentsInOpeningBalance: 0,
    adjustmentsNotImported: 0,
  },
  leftOut: { budgets: 2, zeroAmountMovements: 0 },
  warnings: [],
  errors: [],
  ...overrides,
});

/**
 * P337, board 1: two people and two accounts to archive (a starter duplicate and an empty card), for the account step;
 * `previewFixture({ accounts: [...previewFixture().accounts, ...SORTED_ACCOUNTS] })` has all seven.
 */
export const SORTED_ACCOUNTS: ImportPreviewDto["accounts"] = [
  {
    sourceId: "a-4",
    name: "Mom Loan",
    type: "OTHER",
    currency: "COP",
    cutOffDay: null,
    paymentDay: null,
    sourceClosingBalance: { amount: "50000000", currency: "COP" },
    hidden: false,
    movementCount: 6,
    suggested: "PERSON",
    options: {
      account: { kind: "new", type: "OTHER", currency: "COP" },
      person: { kind: "person", name: "Mom" },
      archive: { kind: "archive", accountId: null, type: "OTHER", currency: "COP" },
    },
    duplicateOf: null,
    mapping: { kind: "person", name: "Mom" },
  },
  {
    sourceId: "a-5",
    name: "Jhon López",
    type: "OTHER",
    currency: "COP",
    cutOffDay: null,
    paymentDay: null,
    sourceClosingBalance: { amount: "-12000000", currency: "COP" },
    hidden: false,
    movementCount: 2,
    suggested: "PERSON",
    options: {
      account: { kind: "new", type: "OTHER", currency: "COP" },
      person: { kind: "person", name: "Jhon López" },
      archive: { kind: "archive", accountId: null, type: "OTHER", currency: "COP" },
    },
    duplicateOf: null,
    mapping: { kind: "person", name: "Jhon López" },
  },
  {
    sourceId: "a-6",
    name: "Cash",
    type: "CASH",
    currency: "COP",
    cutOffDay: null,
    paymentDay: null,
    sourceClosingBalance: { amount: "0", currency: "COP" },
    hidden: false,
    movementCount: 3,
    suggested: "ARCHIVE",
    options: {
      account: { kind: "new", type: "CASH", currency: "COP" },
      person: { kind: "person", name: "Cash" },
      archive: { kind: "archive", accountId: "acc-cash", type: "CASH", currency: "COP" },
    },
    duplicateOf: { id: "acc-cash", name: "Efectivo" },
    mapping: { kind: "archive", accountId: "acc-cash", type: "CASH", currency: "COP" },
  },
  {
    sourceId: "a-7",
    name: "Card",
    type: "CREDIT_CARD",
    currency: "COP",
    cutOffDay: null,
    paymentDay: null,
    sourceClosingBalance: { amount: "0", currency: "COP" },
    hidden: false,
    movementCount: 0,
    suggested: "ARCHIVE",
    options: {
      account: { kind: "new", type: "CREDIT_CARD", currency: "COP" },
      person: { kind: "person", name: "Card" },
      archive: { kind: "archive", accountId: null, type: "CREDIT_CARD", currency: "COP" },
    },
    duplicateOf: null,
    mapping: { kind: "archive", accountId: null, type: "CREDIT_CARD", currency: "COP", name: "Card" },
  },
];

export const resultFixture = (overrides: Partial<ImportResultDto> = {}): ImportResultDto => ({
  id: "imp-1",
  status: "CONFIRMED",
  counts: {
    accountsCreated: 2,
    accountsRestored: 0,
    categoriesCreated: 2,
    categoriesRestored: 0,
    movementsImported: 1237,
    alreadyImported: 0,
    duplicatesSkipped: 3,
    adjustmentsInOpeningBalance: 0,
    adjustmentsNotImported: 0,
    rowErrors: 0,
    peopleCreated: 0,
    accountsArchived: 0,
    hearthCategoriesArchived: 0,
  },
  rowErrors: [],
  ...overrides,
});

export const summaryFixture = (overrides: Partial<ImportSummaryDto> = {}): ImportSummaryDto => ({
  id: "imp-1",
  sourceApp: "money-manager",
  status: "CONFIRMED",
  createdAt: "2026-11-15T15:00:00.000Z",
  confirmedAt: "2026-11-15T15:05:00.000Z",
  undoneAt: null,
  counts: resultFixture().counts,
  ...overrides,
});

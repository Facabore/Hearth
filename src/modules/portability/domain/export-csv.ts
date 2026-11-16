import { minorUnitsOf } from "@/shared/kernel/minor-units";
import type {
  ExportDocument,
  ExportedMovement,
  ExportedSpace,
  MemberRef,
  MoneyValue,
} from "./export-document";

/** A spreadsheet reads a cell starting with one of these as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/;
/** RFC 4180: a field holding a comma, a quote or a line break is quoted. */
const NEEDS_QUOTES = /[",\r\n]/;

const quoted = (cell: string): string => (NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/**
 * Design §3.6: a free-text cell (a description, a name). One a spreadsheet would run as a formula gets an apostrophe in
 * front, so it shows as text; then it is quoted as RFC 4180 asks.
 */
export const textCell = (value: string): string => quoted(FORMULA_START.test(value) ? `'${value}` : value);

/**
 * Design §3.6: minor units as a plain decimal with a dot, by the currency's ISO 4217 exponent (COP 1600000 →
 * "16000.00"), so any spreadsheet reads it whatever the person's display formats. Written here from a bigint, so it
 * is always a number and never takes the formula guard, a negative one included.
 */
export const decimalCell = (minor: bigint, currency: string): string => {
  const { exponent } = minorUnitsOf(currency);
  const negative = minor < 0n;
  const digits = (negative ? -minor : minor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? "-" : ""}${whole}${exponent > 0 ? `.${fraction}` : ""}`;
};

/** UTF-8 byte order mark: spreadsheets read accents right only with it. */
const BOM = "﻿";

/**
 * A CSV file of already written cells (`textCell`, `decimalCell` or plain ISO values): a BOM, the header, and one row
 * per line, every line ending in CRLF (RFC 4180).
 */
export const csvTable = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  BOM + [header.map(textCell), ...rows].map((row) => `${row.join(",")}\r\n`).join("");

const MOVEMENT_HEADER = [
  "space",
  "date",
  "time",
  "time zone",
  "type",
  "description",
  "group",
  "category",
  "amount",
  "currency",
  "paid by",
  "account",
  "shares",
];
const ACCOUNT_HEADER = [
  "space",
  "name",
  "type",
  "currency",
  "opening balance",
  "archived",
  "credit limit",
  "cut-off day",
  "payment day",
  "monthly rate (ppm)",
  "annual rate (ppm)",
  "term days",
  "maturity date",
  "principal",
  "term months",
];
const CATEGORY_HEADER = ["space", "group", "category", "subcategory", "catalog key", "archived"];

const joined = (parts: readonly (string | null)[]): string =>
  parts.filter((p) => p !== null && p !== "").join("; ");
const nameOf = (member: MemberRef | null): string | null => member?.name ?? null;
const numberOrBlank = (value: number | null): string => (value === null ? "" : String(value));
const moneyOrBlank = (value: MoneyValue | null): string =>
  value === null ? "" : decimalCell(BigInt(value.amount), value.currency);

/** Who paid, as the person sees it: members by name, a fund by its name. */
const paidBy = (m: ExportedMovement): string => {
  if (m.type === "EXPENSE") return joined(m.payments.map((p) => nameOf(p.member) ?? p.account?.name ?? null));
  if (m.type === "INCOME") return nameOf(m.receiver) ?? "";
  return nameOf(m.payer) ?? "";
};

/** The accounts the person sees on the movement; another member's personal account is never among them (D9). */
const accountsOf = (m: ExportedMovement): string =>
  m.type === "EXPENSE"
    ? joined(m.payments.map((p) => p.account?.name ?? null))
    : [m.sourceAccount?.name, m.destinationAccount?.name].filter((n) => n !== undefined).join(" → ");

const movementRow = (space: ExportedSpace, m: ExportedMovement): string[] => [
  textCell(space.name),
  m.date,
  m.time ?? "",
  m.timeZone ?? "",
  m.type,
  textCell(m.description),
  textCell(m.category?.group ?? ""),
  textCell(
    m.category === null
      ? ""
      : m.category.parent === null
        ? m.category.name
        : `${m.category.parent} › ${m.category.name}`,
  ),
  // #329: a balance adjustment keeps its direction in the CSV, money out of its account as a negative amount.
  decimalCell(
    m.type === "ADJUSTMENT" && m.sourceAccount !== null ? -BigInt(m.amount.amount) : BigInt(m.amount.amount),
    m.amount.currency,
  ),
  m.amount.currency,
  textCell(paidBy(m)),
  textCell(accountsOf(m)),
  textCell(
    joined(
      m.shares.map(
        (s) => `${s.member.name ?? ""}: ${decimalCell(BigInt(s.amount.amount), s.amount.currency)}`,
      ),
    ),
  ),
];

/** Design §3.6: the CSV export's three files, each with a BOM, one row per movement, account or category. */
export const exportTables = (
  document: ExportDocument,
): { readonly movements: string; readonly accounts: string; readonly categories: string } => ({
  movements: csvTable(
    MOVEMENT_HEADER,
    document.spaces.flatMap((space) => space.movements.map((m) => movementRow(space, m))),
  ),
  accounts: csvTable(
    ACCOUNT_HEADER,
    document.spaces.flatMap((space) =>
      space.accounts.map((a) => [
        textCell(space.name),
        textCell(a.name),
        a.type,
        a.currency,
        decimalCell(BigInt(a.openingBalance.amount), a.currency),
        a.archived ? "yes" : "no",
        moneyOrBlank(a.terms.creditLimit),
        numberOrBlank(a.terms.cutOffDay),
        numberOrBlank(a.terms.paymentDay),
        numberOrBlank(a.terms.monthlyRatePpm),
        numberOrBlank(a.terms.annualRatePpm),
        numberOrBlank(a.terms.termDays),
        a.terms.maturityDate ?? "",
        moneyOrBlank(a.terms.principal),
        numberOrBlank(a.terms.termMonths),
      ]),
    ),
  ),
  categories: csvTable(
    CATEGORY_HEADER,
    document.spaces.flatMap((space) =>
      space.categoryGroups.flatMap((group) =>
        group.categories.flatMap((category) => [
          [
            textCell(space.name),
            textCell(group.name),
            textCell(category.name),
            "",
            category.key ?? "",
            category.archived ? "yes" : "no",
          ],
          ...category.subcategories.map((sub) => [
            textCell(space.name),
            textCell(group.name),
            textCell(category.name),
            textCell(sub.name),
            sub.key ?? "",
            sub.archived ? "yes" : "no",
          ]),
        ]),
      ),
    ),
  ),
});

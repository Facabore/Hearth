import { constants, DatabaseSync } from "node:sqlite";
import {
  currencyOf,
  domainError,
  err,
  isErr,
  localDate,
  ok,
  type DomainError,
  type Money,
  type Result,
} from "@/shared/kernel";
import type { SourceAdapter, SourceFile } from "../application/source-adapter";
import { moneyFromDecimal, moneyFromFloat } from "../domain/amounts";
import { accountTypeForGroup } from "../domain/account-type-map";
import { splitLeadingEmoji } from "../domain/category-match";
import type {
  SourceAccount,
  SourceBudget,
  SourceCategory,
  SourceIssue,
  SourceMovement,
  SourceSnapshot,
} from "../domain/source-snapshot";

type Row = Record<string, unknown>;

/** The largest upload an import reads (design §3.5); a bigger one is refused before any parsing. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** Every SQLite 3 file starts with these 16 bytes ("SQLite format 3" and a NUL). */
const SQLITE_HEADER = new TextEncoder().encode("SQLite format 3\u0000");

/** The tables this reader queries. Each must be a real table, so a crafted view cannot make a query run unbounded. */
const READ_TABLES = ["CURRENCY", "ASSETS", "ZCATEGORY", "INOUTCOME", "TAG", "TX_TAG", "BUDGET", "ZETC"];

const startsWith = (bytes: Uint8Array, prefix: Uint8Array): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

const str = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
/** A float amount field: a missing value is NaN (refused as a row error), never a silent zero. */
const floatField = (value: unknown): number =>
  typeof value === "number" ? value : value == null || value === "" ? Number.NaN : Number(value);
const trimmed = (value: unknown): string | null => {
  const text = str(value).trim();
  return text === "" ? null : text;
};
const isSet = (value: unknown): value is string => trimmed(value) !== null && trimmed(value) !== "0";

/** A row-level problem as code plus plain-string data, for the preview to word (design §3.2). */
/** A backup is never asked for more tags per movement than a note can usefully carry. */
const MAX_TAGS_PER_MOVEMENT = 10;

const rowIssue = (sourceKey: string, error: DomainError): SourceIssue =>
  error.details === undefined
    ? { code: error.code, sourceKey }
    : {
        code: error.code,
        sourceKey,
        details: Object.fromEntries(
          Object.entries(error.details).map(([key, value]) => [key, String(value)]),
        ),
      };

/** Only reads: any write, ATTACH, PRAGMA, function call or recursive query in this connection is refused. */
const readOnlyAuthorizer = (actionCode: number): number =>
  actionCode === constants.SQLITE_SELECT || actionCode === constants.SQLITE_READ
    ? constants.SQLITE_OK
    : constants.SQLITE_DENY;

/**
 * Reads a Money Manager (Realbyte, Android/iOS) SQLite backup and translates it into a neutral `SourceSnapshot`
 * (design §1-2). The upload is untrusted (§3.5): at most `MAX_IMPORT_BYTES`, loaded from its bytes into an in-memory
 * `node:sqlite` database (`deserialize`; never a file on disk), with extensions off, the defensive flag on, and an
 * authorizer that only lets it read. A `.mmbak` that is a zip is reported as not yet supported
 * (`ZipBackupNotSupported`); only the raw `.sqlite` is read for now.
 */
export class MoneyManagerAdapter implements SourceAdapter {
  readonly sourceApp = "money-manager";

  detect(file: SourceFile): boolean {
    const opened = this.open(file.bytes);
    if (isErr(opened)) return false;
    try {
      return this.recognized(opened.value);
    } catch {
      return false;
    } finally {
      opened.value.close();
    }
  }

  read(file: SourceFile): Result<SourceSnapshot> {
    const opened = this.open(file.bytes);
    if (isErr(opened)) return opened;
    const db = opened.value;
    try {
      if (!this.recognized(db)) return err(domainError("ImportFileNotRecognized", { app: this.sourceApp }));
      return this.build(db);
    } catch (cause) {
      return err(domainError("UnreadableBackup", { app: this.sourceApp, reason: String(cause) }));
    } finally {
      db.close();
    }
  }

  /** Size, then zip, then the SQLite header, all before parsing; then the bytes become a read-only memory database. */
  private open(bytes: Uint8Array): Result<DatabaseSync> {
    if (bytes.length > MAX_IMPORT_BYTES) {
      return err(domainError("ImportFileTooLarge", { maxBytes: MAX_IMPORT_BYTES }));
    }
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      // "PK": a zip local-file header
      return err(domainError("ZipBackupNotSupported", { app: this.sourceApp }));
    }
    if (!startsWith(bytes, SQLITE_HEADER)) {
      return err(domainError("ImportFileNotRecognized", { app: this.sourceApp }));
    }
    const db = new DatabaseSync(":memory:", { allowExtension: false, defensive: true });
    try {
      // `deserialize` copies the bytes into SQLite's own memory; the caller's buffer is never touched.
      db.deserialize(bytes);
      db.setAuthorizer(readOnlyAuthorizer);
      return ok(db);
    } catch (cause) {
      db.close();
      return err(domainError("UnreadableBackup", { app: this.sourceApp, reason: String(cause) }));
    }
  }

  /** Money Manager's two core tables exist, and nothing the reader queries is a view (names are case-insensitive). */
  private recognized(db: DatabaseSync): boolean {
    const types = new Map(
      this.all(db, "SELECT name, type FROM sqlite_master").map((row) => [
        str(row.name).toUpperCase(),
        str(row.type),
      ]),
    );
    const isTable = (name: string) => types.get(name) === "table";
    return (
      isTable("ASSETS") && isTable("INOUTCOME") && READ_TABLES.every((name) => types.get(name) !== "view")
    );
  }

  private all(db: DatabaseSync, sql: string): Row[] {
    return db.prepare(sql).all() as Row[];
  }

  private build(db: DatabaseSync): Result<SourceSnapshot> {
    const currencyByUid = new Map<number, string>();
    let mainCurrency: string | null = null;
    for (const row of this.all(db, "SELECT uid, ISO, MAIN_ISO, IS_MAIN_CURRENCY FROM CURRENCY")) {
      const iso = str(row.ISO);
      currencyByUid.set(num(row.uid), iso);
      if (num(row.IS_MAIN_CURRENCY) !== 0) mainCurrency = iso;
      if (mainCurrency === null && trimmed(row.MAIN_ISO)) mainCurrency = str(row.MAIN_ISO);
    }

    // Accounts, minus their type, which needs each account's balance (group 5 Loan, gap G4).
    // An account in a currency the backup does not list, or Hearth does not know, is a row error: its movements then
    // come out as MovementWithoutAccount, and the rest of the backup still reads (§3.2).
    const accountInfo = new Map<string, { row: Row; currency: string; groupUid: number }>();
    const accountErrors: SourceIssue[] = [];
    for (const row of this.all(db, "SELECT * FROM ASSETS")) {
      const currency = currencyByUid.get(num(row.currencyUid));
      if (currency === undefined || isErr(currencyOf(currency))) {
        accountErrors.push(
          rowIssue(
            str(row.uid),
            domainError("UnknownCurrency", { currency: currency ?? String(row.currencyUid ?? "") }),
          ),
        );
        continue;
      }
      accountInfo.set(str(row.uid), { row, currency, groupUid: num(row.groupUid) });
    }

    const tagsByMovement = this.tags(db);
    const { movements, zeroAmountMovements, usedCategories, warnings, errors, balances } = this.movements(
      db,
      accountInfo,
      tagsByMovement,
      currencyByUid,
    );

    const accounts: SourceAccount[] = [];
    for (const [sourceId, info] of accountInfo) {
      const { row } = info;
      const cardDay = (field: string) => (num(row[field]) > 0 ? num(row[field]) : null);
      accounts.push({
        sourceId,
        name: str(row.NIC_NAME),
        type: accountTypeForGroup(info.groupUid, (balances.get(sourceId) ?? 0n) < 0n),
        currency: info.currency,
        order: num(row.ORDERSEQ),
        cutOffDay: cardDay("CARD_DAY_FIN"),
        paymentDay: cardDay("CARD_DAY_PAY"),
        memo: trimmed(row.ZDATA1),
        hidden: num(row.ZDATA) !== 0,
        excludedFromTotals: num(row.ZDATA2) !== 0,
      });
    }

    const { categories, deletedCategories } = this.categories(db, usedCategories);
    const budgets: SourceBudget[] = this.all(db, "SELECT uid, ctgUid FROM BUDGET").map((row) => ({
      sourceId: str(row.uid),
      categorySourceId: trimmed(row.ctgUid),
    }));

    return ok({
      sourceApp: this.sourceApp,
      accounts,
      categories,
      movements,
      budgets,
      settings: { startDay: this.startDay(db), mainCurrency },
      skipped: { zeroAmountMovements, deletedCategories },
      warnings,
      errors: [...accountErrors, ...errors],
    });
  }

  /**
   * Each movement's tag names. The two tables are read apart and joined here, never in SQL: a crafted backup whose
   * TX_TAG and TAG rows all share one uid would make a SQL join's output grow as their product. Names are kept once
   * each, at most MAX_TAGS_PER_MOVEMENT per movement.
   */
  private tags(db: DatabaseSync): Map<string, string[]> {
    const names = new Map<string, string>();
    for (const row of this.all(db, "SELECT uid, NAME FROM TAG")) {
      const name = trimmed(row.NAME);
      if (name !== null && !names.has(str(row.uid))) names.set(str(row.uid), name);
    }
    const byMovement = new Map<string, Set<string>>();
    for (const row of this.all(db, "SELECT txUid, tagUid FROM TX_TAG")) {
      const name = names.get(str(row.tagUid));
      if (name === undefined) continue;
      const key = str(row.txUid);
      const tags = byMovement.get(key) ?? byMovement.set(key, new Set()).get(key)!;
      if (tags.size < MAX_TAGS_PER_MOVEMENT) tags.add(name);
    }
    return new Map([...byMovement].map(([key, tags]) => [key, [...tags]]));
  }

  private note(texts: readonly unknown[], tags: readonly string[]): string | null {
    const body = texts
      .map(trimmed)
      .filter((t): t is string => t !== null)
      .join(" · ");
    const full = [body, tags.map((t) => `#${t}`).join(" ")].filter((s) => s !== "").join(" ");
    return full === "" ? null : full;
  }

  private movements(
    db: DatabaseSync,
    accountInfo: Map<string, { currency: string }>,
    tagsByMovement: Map<string, string[]>,
    currencyByUid: Map<number, string>,
  ): {
    movements: SourceMovement[];
    zeroAmountMovements: number;
    usedCategories: Set<string>;
    warnings: SourceIssue[];
    errors: SourceIssue[];
    balances: Map<string, bigint>;
  } {
    const movements: SourceMovement[] = [];
    const usedCategories = new Set<string>();
    const warnings: SourceIssue[] = [];
    const errors: SourceIssue[] = [];
    const balances = new Map<string, bigint>();
    // Keyed by `txUidTrans`; a row without one is keyed by its own `uid` (in a separate key space), so it never pairs
    // with another such row and is reported under its own key.
    const transfers = new Map<string, { sourceKey: string; out?: Row; in?: Row }>();
    let zeroAmountMovements = 0;

    // ZDATE is epoch milliseconds; one out of Date's range keeps the movement, untimed, with a warning.
    const instantOf = (row: Row, sourceKey: string): Date | null => {
      const ms = num(row.ZDATE);
      if (!(ms > 0)) return null;
      const instant = new Date(ms);
      if (Number.isNaN(instant.getTime())) {
        warnings.push({ code: "InvalidInstant", sourceKey });
        return null;
      }
      return instant;
    };

    const bump = (accountId: string, minor: bigint) =>
      balances.set(accountId, (balances.get(accountId) ?? 0n) + minor);

    // The amount in an account's own currency: the entered decimal when the currencies match (exact), else the
    // account-currency float the app pre-computed (AMOUNT_ACCOUNT), rounded with the kernel only (design §2.3).
    const accountAmount = (row: Row, accountCurrency: string): Result<Money> => {
      const entered = currencyByUid.get(num(row.currencyUid));
      return entered === accountCurrency
        ? moneyFromDecimal(str(row.IN_ZMONEY), accountCurrency)
        : moneyFromFloat(floatField(row.AMOUNT_ACCOUNT), accountCurrency);
    };

    for (const row of this.all(db, "SELECT * FROM INOUTCOME")) {
      if (num(row.IS_DEL) !== 0) continue;
      const uid = str(row.uid);
      const doType = num(row.DO_TYPE);
      if (doType === 3 || doType === 4) {
        const shared = trimmed(row.txUidTrans);
        const key = shared === null ? `row:${uid}` : `tx:${shared}`;
        const pair = transfers.get(key) ?? transfers.set(key, { sourceKey: shared ?? uid }).get(key)!;
        if (doType === 3) pair.out = row;
        else pair.in = row;
        continue;
      }

      // 0 income, 1 expense, 7 and 8 balance adjustments (design §1.2); any other type is not guessed at.
      if (doType !== 0 && doType !== 1 && doType !== 7 && doType !== 8) {
        errors.push({ code: "UnknownMovementType", sourceKey: uid, details: { doType: String(doType) } });
        continue;
      }
      const account = accountInfo.get(str(row.assetUid));
      if (account === undefined) {
        warnings.push({ code: "MovementWithoutAccount", sourceKey: uid });
        continue;
      }
      const date = localDate(str(row.WDATE));
      if (isErr(date)) {
        errors.push(rowIssue(uid, date.error));
        continue;
      }
      const amount = accountAmount(row, account.currency);
      if (isErr(amount)) {
        errors.push(rowIssue(uid, amount.error));
        continue;
      }
      if (amount.value.minor === 0n) {
        zeroAmountMovements += 1;
        continue;
      }

      const entered = currencyByUid.get(num(row.currencyUid));
      let originalAmount: Money | null = null;
      if (entered !== undefined && entered !== account.currency) {
        const original = moneyFromDecimal(str(row.IN_ZMONEY), entered);
        if (isErr(original)) {
          errors.push(rowIssue(uid, original.error));
          continue;
        }
        originalAmount = original.value;
      }

      const kind = doType === 0 ? "INCOME" : doType === 1 ? "EXPENSE" : "ADJUSTMENT";
      const categorySourceId = kind === "ADJUSTMENT" ? null : trimmed(row.ctgUid);
      if (categorySourceId !== null) usedCategories.add(categorySourceId);

      bump(str(row.assetUid), kind === "EXPENSE" ? -amount.value.minor : amount.value.minor);
      movements.push({
        sourceKey: uid,
        kind,
        date: date.value,
        occurredAt: instantOf(row, uid),
        accountSourceId: str(row.assetUid),
        toAccountSourceId: null,
        categorySourceId,
        amount: amount.value,
        originalAmount,
        toAmount: null,
        note: this.note([row.ZCONTENT, row.ZDATA], tagsByMovement.get(uid) ?? []),
      });
    }

    for (const { sourceKey: key, out, in: into } of transfers.values()) {
      if (!out || !into) {
        warnings.push({ code: "TransferIncomplete", sourceKey: key });
        continue;
      }
      const from = accountInfo.get(str(out.assetUid));
      const to = accountInfo.get(str(into.assetUid));
      if (from === undefined || to === undefined) {
        warnings.push({ code: "TransferWithoutAccount", sourceKey: key });
        continue;
      }
      const date = localDate(str(out.WDATE));
      if (isErr(date)) {
        errors.push(rowIssue(key, date.error));
        continue;
      }
      const fromAmount = accountAmount(out, from.currency);
      if (isErr(fromAmount)) {
        errors.push(rowIssue(key, fromAmount.error));
        continue;
      }
      const toAmount = accountAmount(into, to.currency);
      if (isErr(toAmount)) {
        errors.push(rowIssue(key, toAmount.error));
        continue;
      }
      const fromZero = fromAmount.value.minor === 0n;
      const toZero = toAmount.value.minor === 0n;
      if (fromZero && toZero) {
        zeroAmountMovements += 1;
        continue;
      }
      if (fromZero || toZero) {
        // Money left one account and nothing reached the other (or the reverse): never imported with a zero side.
        warnings.push({ code: "TransferOneSideZero", sourceKey: key });
        continue;
      }

      bump(str(out.assetUid), -fromAmount.value.minor);
      bump(str(into.assetUid), toAmount.value.minor);
      movements.push({
        sourceKey: key,
        kind: "TRANSFER",
        date: date.value,
        occurredAt: instantOf(out, key),
        accountSourceId: str(out.assetUid),
        toAccountSourceId: str(into.assetUid),
        categorySourceId: null,
        amount: fromAmount.value,
        originalAmount: null,
        toAmount: toAmount.value,
        note: this.note([out.ZCONTENT, out.ZDATA], tagsByMovement.get(str(out.uid)) ?? []),
      });
    }

    return { movements, zeroAmountMovements, usedCategories, warnings, errors, balances };
  }

  private categories(
    db: DatabaseSync,
    usedCategories: Set<string>,
  ): { categories: SourceCategory[]; deletedCategories: number } {
    const categories: SourceCategory[] = [];
    let deletedCategories = 0;
    for (const row of this.all(db, "SELECT * FROM ZCATEGORY")) {
      const deleted = num(row.C_IS_DEL) !== 0;
      const sourceId = str(row.uid);
      // A deleted category is imported only when a movement still uses it, then archived (design §2.2).
      if (deleted && !usedCategories.has(sourceId)) {
        deletedCategories += 1;
        continue;
      }
      const { icon, name } = splitLeadingEmoji(str(row.NAME));
      categories.push({
        sourceId,
        name,
        icon,
        kind: num(row.TYPE) === 0 ? "INCOME" : "EXPENSE",
        parentSourceId: num(row.STATUS) === 2 && isSet(row.pUid) ? str(row.pUid).trim() : null,
        deleted,
        order: num(row.ORDERSEQ),
      });
    }
    return { categories, deletedCategories };
  }

  private startDay(db: DatabaseSync): number | null {
    const row = this.all(db, "SELECT VALUE FROM ZETC WHERE dataTypeKey = 'start_day'")[0];
    if (row === undefined) return null;
    const value = Number(str(row.VALUE));
    return Number.isInteger(value) ? value : null;
  }
}

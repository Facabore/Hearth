import { closeSync, openSync, readSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { currencyOf, domainError, err, isErr, localDate, ok, type Money, type Result } from "@/shared/kernel";
import type { SourceAdapter, SourceFile } from "../application/source-adapter";
import { moneyFromDecimal, moneyFromFloat } from "../domain/amounts";
import { accountTypeForGroup } from "../domain/account-type-map";
import { splitLeadingEmoji } from "../domain/category-match";
import type {
  SourceAccount,
  SourceBudget,
  SourceCategory,
  SourceMovement,
  SourceSnapshot,
} from "../domain/source-snapshot";

type Row = Record<string, unknown>;

const str = (value: unknown): string =>
  typeof value === "string" ? value : value == null ? "" : String(value);
const num = (value: unknown): number => (typeof value === "number" ? value : Number(value ?? 0));
const trimmed = (value: unknown): string | null => {
  const text = str(value).trim();
  return text === "" ? null : text;
};
const isSet = (value: unknown): value is string => trimmed(value) !== null && trimmed(value) !== "0";

/**
 * Reads a Money Manager (Realbyte, Android/iOS) SQLite backup read-only and translates it into a neutral
 * `SourceSnapshot` (design §1-2). It uses Node's built-in `node:sqlite`; no new dependency and no network. A `.mmbak`
 * that is a zip is reported as not yet supported (`ZipBackupNotSupported`); only the raw `.sqlite` is read for now.
 */
export class MoneyManagerAdapter implements SourceAdapter {
  readonly sourceApp = "money-manager";

  detect(file: SourceFile): boolean {
    if (this.isZip(file.path)) return false;
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file.path, { readOnly: true });
      const tables = new Set(
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => str((row as Row).name)),
      );
      return tables.has("ASSETS") && tables.has("INOUTCOME");
    } catch {
      return false;
    } finally {
      db?.close();
    }
  }

  read(file: SourceFile): Result<SourceSnapshot> {
    if (this.isZip(file.path)) {
      return err(domainError("ZipBackupNotSupported", { app: this.sourceApp }));
    }
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(file.path, { readOnly: true });
      return this.build(db);
    } catch (cause) {
      return err(domainError("UnreadableBackup", { app: this.sourceApp, reason: String(cause) }));
    } finally {
      db?.close();
    }
  }

  private isZip(path: string): boolean {
    const head = Buffer.alloc(2);
    let fd: number | undefined;
    try {
      fd = openSync(path, "r");
      readSync(fd, head, 0, 2, 0);
    } catch {
      return false;
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    return head[0] === 0x50 && head[1] === 0x4b; // "PK": a zip local-file header
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
    const accountInfo = new Map<string, { row: Row; currency: string; groupUid: number }>();
    for (const row of this.all(db, "SELECT * FROM ASSETS")) {
      const currency = currencyByUid.get(num(row.currencyUid));
      if (currency === undefined || isErr(currencyOf(currency))) {
        return err(domainError("UnreadableBackup", { app: this.sourceApp, reason: "currency" }));
      }
      accountInfo.set(str(row.uid), { row, currency, groupUid: num(row.groupUid) });
    }

    const tagsByMovement = this.tags(db);
    const movementsResult = this.movements(db, accountInfo, tagsByMovement, currencyByUid);
    if (isErr(movementsResult)) return movementsResult;
    const { movements, zeroAmountMovements, usedCategories, warnings, balances } = movementsResult.value;

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
    });
  }

  private tags(db: DatabaseSync): Map<string, string[]> {
    const byMovement = new Map<string, string[]>();
    for (const row of this.all(
      db,
      "SELECT TX_TAG.txUid AS txUid, TAG.NAME AS NAME FROM TX_TAG JOIN TAG ON TAG.uid = TX_TAG.tagUid",
    )) {
      const key = str(row.txUid);
      const name = trimmed(row.NAME);
      if (name === null) continue;
      (byMovement.get(key) ?? byMovement.set(key, []).get(key)!).push(name);
    }
    return byMovement;
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
  ): Result<{
    movements: SourceMovement[];
    zeroAmountMovements: number;
    usedCategories: Set<string>;
    warnings: string[];
    balances: Map<string, bigint>;
  }> {
    const movements: SourceMovement[] = [];
    const usedCategories = new Set<string>();
    const warnings: string[] = [];
    const balances = new Map<string, bigint>();
    const transfers = new Map<string, { out?: Row; in?: Row }>();
    let zeroAmountMovements = 0;

    const bump = (accountId: string, minor: bigint) =>
      balances.set(accountId, (balances.get(accountId) ?? 0n) + minor);

    // The amount in an account's own currency: the entered decimal when the currencies match (exact), else the
    // account-currency float the app pre-computed (AMOUNT_ACCOUNT), rounded with the kernel only (design §2.3).
    const accountAmount = (row: Row, accountCurrency: string): Result<Money> => {
      const entered = currencyByUid.get(num(row.currencyUid));
      return entered === accountCurrency
        ? moneyFromDecimal(str(row.IN_ZMONEY), accountCurrency)
        : moneyFromFloat(num(row.AMOUNT_ACCOUNT), accountCurrency);
    };

    for (const row of this.all(db, "SELECT * FROM INOUTCOME")) {
      if (num(row.IS_DEL) !== 0) continue;
      const doType = num(row.DO_TYPE);
      if (doType === 3 || doType === 4) {
        const key = str(row.txUidTrans);
        const pair = transfers.get(key) ?? transfers.set(key, {}).get(key)!;
        if (doType === 3) pair.out = row;
        else pair.in = row;
        continue;
      }

      const account = accountInfo.get(str(row.assetUid));
      if (account === undefined) {
        warnings.push(`Movimiento ${str(row.uid)} sin cuenta`);
        continue;
      }
      const date = localDate(str(row.WDATE));
      if (isErr(date)) return date;
      const amount = accountAmount(row, account.currency);
      if (isErr(amount)) return amount;
      if (amount.value.minor === 0n) {
        zeroAmountMovements += 1;
        continue;
      }

      const kind = doType === 0 ? "INCOME" : doType === 1 ? "EXPENSE" : "ADJUSTMENT";
      const categorySourceId = kind === "ADJUSTMENT" ? null : trimmed(row.ctgUid);
      if (categorySourceId !== null) usedCategories.add(categorySourceId);

      const entered = currencyByUid.get(num(row.currencyUid));
      let originalAmount: Money | null = null;
      if (entered !== undefined && entered !== account.currency) {
        const original = moneyFromDecimal(str(row.IN_ZMONEY), entered);
        if (isErr(original)) return original;
        originalAmount = original.value;
      }

      bump(str(row.assetUid), kind === "EXPENSE" ? -amount.value.minor : amount.value.minor);
      movements.push({
        sourceKey: str(row.uid),
        kind,
        date: date.value,
        occurredAt: num(row.ZDATE) > 0 ? new Date(num(row.ZDATE)) : null,
        accountSourceId: str(row.assetUid),
        toAccountSourceId: null,
        categorySourceId,
        amount: amount.value,
        originalAmount,
        toAmount: null,
        note: this.note([row.ZCONTENT, row.ZDATA], tagsByMovement.get(str(row.uid)) ?? []),
      });
    }

    for (const [key, pair] of transfers) {
      if (!pair.out || !pair.in) {
        warnings.push(`Transferencia ${key} incompleta`);
        continue;
      }
      const from = accountInfo.get(str(pair.out.assetUid));
      const to = accountInfo.get(str(pair.in.assetUid));
      if (from === undefined || to === undefined) {
        warnings.push(`Transferencia ${key} sin cuenta`);
        continue;
      }
      const date = localDate(str(pair.out.WDATE));
      if (isErr(date)) return date;
      const fromAmount = accountAmount(pair.out, from.currency);
      if (isErr(fromAmount)) return fromAmount;
      const toAmount = accountAmount(pair.in, to.currency);
      if (isErr(toAmount)) return toAmount;
      if (fromAmount.value.minor === 0n && toAmount.value.minor === 0n) {
        zeroAmountMovements += 1;
        continue;
      }

      bump(str(pair.out.assetUid), -fromAmount.value.minor);
      bump(str(pair.in.assetUid), toAmount.value.minor);
      movements.push({
        sourceKey: key,
        kind: "TRANSFER",
        date: date.value,
        occurredAt: num(pair.out.ZDATE) > 0 ? new Date(num(pair.out.ZDATE)) : null,
        accountSourceId: str(pair.out.assetUid),
        toAccountSourceId: str(pair.in.assetUid),
        categorySourceId: null,
        amount: fromAmount.value,
        originalAmount: null,
        toAmount: toAmount.value,
        note: this.note([pair.out.ZCONTENT, pair.out.ZDATA], tagsByMovement.get(str(pair.out.uid)) ?? []),
      });
    }

    return ok({ movements, zeroAmountMovements, usedCategories, warnings, balances });
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

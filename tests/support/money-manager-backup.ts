import { DatabaseSync } from "node:sqlite";

/** One INOUTCOME row of a synthetic backup. `toAsset` and `txUidTrans` only for a transfer's two rows. */
export interface BackupMovement {
  readonly uid: string;
  /** 0 income, 1 expense, 3 transfer out, 4 transfer in, 7/8 balance adjustment. */
  readonly doType: number;
  readonly wdate: string;
  /** `ZDATE` in epoch milliseconds; 0 for none. */
  readonly zdate: number;
  readonly asset: string;
  readonly toAsset?: string;
  readonly category?: string;
  /** 1 COP, 2 USD: the currency the amount was entered in. */
  readonly currency: 1 | 2;
  /** `IN_ZMONEY`, what was entered, as Money Manager writes it ("50000.0"). */
  readonly entered: string;
  /** `AMOUNT_ACCOUNT`, the amount in the account's own currency. */
  readonly inAccount: number;
  readonly txUidTrans?: string;
  readonly note?: string;
}

/**
 * The movements of the default backup (D28 import tests): a COP bank with an adjustment before its first movement
 * and one after, an expense with a time, a salary, a COP→USD transfer, a USD expense paid from the COP bank, a USD
 * expense from the USD account (whose base amount needs a rate), and a cash expense. No real or personal data.
 */
export const DEFAULT_MOVEMENTS: readonly BackupMovement[] = [
  {
    uid: "adj0",
    doType: 7,
    wdate: "2025-01-01",
    zdate: 0,
    asset: "a-bank",
    currency: 1,
    entered: "50000.0",
    inAccount: 50000,
  },
  {
    uid: "m1",
    doType: 1,
    wdate: "2025-01-10",
    zdate: Date.UTC(2025, 0, 10, 15, 30),
    asset: "a-bank",
    category: "c-food-sub",
    currency: 1,
    entered: "50000.0",
    inAccount: 50000,
    note: "Almuerzo",
  },
  {
    uid: "m2",
    doType: 0,
    wdate: "2025-01-15",
    zdate: Date.UTC(2025, 0, 15, 14),
    asset: "a-bank",
    category: "c-salary",
    currency: 1,
    entered: "3000000.0",
    inAccount: 3000000,
  },
  {
    uid: "m3",
    doType: 3,
    wdate: "2025-02-01",
    zdate: Date.UTC(2025, 1, 1, 15),
    asset: "a-bank",
    toAsset: "a-usd",
    currency: 1,
    entered: "400000.0",
    inAccount: 400000,
    txUidTrans: "t1",
  },
  {
    uid: "m4",
    doType: 4,
    wdate: "2025-02-01",
    zdate: Date.UTC(2025, 1, 1, 15),
    asset: "a-usd",
    toAsset: "a-bank",
    currency: 2,
    entered: "100.00",
    inAccount: 100,
    txUidTrans: "t1",
  },
  {
    uid: "m5",
    doType: 1,
    wdate: "2025-02-05",
    zdate: Date.UTC(2025, 1, 5, 15),
    asset: "a-bank",
    category: "c-food",
    currency: 2,
    entered: "20.00",
    inAccount: 80000,
  },
  {
    uid: "m6",
    doType: 1,
    wdate: "2025-02-06",
    zdate: Date.UTC(2025, 1, 6, 15),
    asset: "a-usd",
    category: "c-guitar",
    currency: 2,
    entered: "15.00",
    inAccount: 15,
  },
  {
    uid: "m7",
    doType: 1,
    wdate: "2025-01-20",
    zdate: Date.UTC(2025, 0, 20, 15),
    asset: "a-cash",
    category: "c-guitar",
    currency: 1,
    entered: "12000.0",
    inAccount: 12000,
  },
  {
    uid: "adj1",
    doType: 8,
    wdate: "2025-03-01",
    zdate: 0,
    asset: "a-bank",
    currency: 1,
    entered: "-1000.0",
    inAccount: -1000,
  },
];

/**
 * A tiny synthetic Money Manager SQLite backup, built in memory and returned as bytes; nothing touches the disk.
 * Accounts: "Efectivo" (cash, COP, the name of a starter account), "Banco Uno" (bank, COP), "US savings" (bank, USD)
 * and "Visa" (card, COP, cut-off 15, payment 5). Categories: "🍔 Food" with its subcategory "Supermercado",
 * "💰 Salary" (income) and "🎸 Guitarra".
 */
export const moneyManagerBackup = (movements: readonly BackupMovement[] = DEFAULT_MOVEMENTS): Uint8Array => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE CURRENCY (uid INTEGER, ISO TEXT, MAIN_ISO TEXT, IS_MAIN_CURRENCY INTEGER, RATE TEXT, DECIMAL_POINT INTEGER, SYMBOL_POSITION INTEGER);
    CREATE TABLE ASSETS (uid TEXT, NIC_NAME TEXT, groupUid INTEGER, currencyUid INTEGER, ORDERSEQ INTEGER, CARD_DAY_FIN INTEGER, CARD_DAY_PAY INTEGER, cardAssetUid TEXT, ZDATA1 TEXT, ZDATA INTEGER, ZDATA2 INTEGER);
    CREATE TABLE ZCATEGORY (uid TEXT, NAME TEXT, TYPE INTEGER, pUid TEXT, STATUS INTEGER, C_IS_DEL INTEGER, ORDERSEQ INTEGER);
    CREATE TABLE INOUTCOME (uid TEXT, DO_TYPE INTEGER, WDATE TEXT, ZDATE INTEGER, UTIME INTEGER, assetUid TEXT, toAssetUid TEXT, ctgUid TEXT, ZMONEY TEXT, currencyUid INTEGER, IN_ZMONEY TEXT, AMOUNT_ACCOUNT REAL, txUidTrans TEXT, ZCONTENT TEXT, ZDATA TEXT, IS_DEL INTEGER);
    CREATE TABLE TAG (uid TEXT, NAME TEXT);
    CREATE TABLE TX_TAG (txUid TEXT, tagUid TEXT);
    CREATE TABLE BUDGET (uid TEXT, targetUid TEXT, BUDGET_PERIOD INTEGER);
    CREATE TABLE ZETC (dataTypeKey TEXT, ZDATA TEXT);
  `);
  const currency = db.prepare("INSERT INTO CURRENCY VALUES (?,?,?,?,?,?,?)");
  currency.run(1, "COP", "COP", 1, "1", 0, 0);
  currency.run(2, "USD", "COP", 0, "4000", 2, 0);
  const asset = db.prepare("INSERT INTO ASSETS VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  asset.run("a-cash", "Efectivo", 11, 1, 0, 0, 0, null, null, 0, 0);
  asset.run("a-bank", "Banco Uno", 1, 1, 1, 0, 0, null, null, 0, 0);
  asset.run("a-usd", "US savings", 1, 2, 2, 0, 0, null, null, 0, 0);
  asset.run("a-card", "Visa", 2, 1, 3, 15, 5, "a-bank", null, 0, 0);
  const category = db.prepare("INSERT INTO ZCATEGORY VALUES (?,?,?,?,?,?,?)");
  category.run("c-food", "🍔 Food", 1, "", 0, 0, 0);
  category.run("c-food-sub", "Supermercado", 1, "c-food", 2, 0, 0);
  category.run("c-salary", "💰 Salary", 0, "", 0, 0, 1);
  category.run("c-guitar", "🎸 Guitarra", 1, "", 0, 0, 2);
  const movement = db.prepare("INSERT INTO INOUTCOME VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  for (const m of movements) {
    movement.run(
      m.uid,
      m.doType,
      m.wdate,
      m.zdate,
      0,
      m.asset,
      m.toAsset ?? "",
      m.category ?? "",
      m.entered,
      m.currency,
      m.entered,
      m.inAccount,
      m.txUidTrans ?? "",
      m.note ?? "",
      "",
      0,
    );
  }
  db.prepare("INSERT INTO ZETC VALUES (?,?)").run("start_day", "1");
  const bytes = db.serialize();
  db.close();
  return bytes;
};

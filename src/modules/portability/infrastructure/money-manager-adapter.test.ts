import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { isErr, type Result } from "@/shared/kernel";
import type { SourceSnapshot } from "../domain/source-snapshot";
import { MAX_IMPORT_BYTES, MoneyManagerAdapter } from "./money-manager-adapter";
import { MONEY_MANAGER_TABLES } from "../../../../tests/support/money-manager-real-schema";

type MovementRow = [
  uid: string,
  doType: number,
  wdate: string,
  zdate: number,
  asset: string,
  ctg: string,
  currencyUid: number,
  inZmoney: string,
  amountAccount: number,
  txUidTrans: string,
];

/**
 * Builds a tiny, synthetic Money Manager SQLite backup covering every mapping rule, in memory, and returns its bytes:
 * nothing is written to disk. No real or personal data. `extra` adds movement rows for one test.
 */
const buildFixture = (extra: readonly MovementRow[] = [], extraSql = ""): Uint8Array => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE CURRENCY (uid INTEGER, ISO TEXT, MAIN_ISO TEXT, IS_MAIN_CURRENCY INTEGER, RATE TEXT, DECIMAL_POINT INTEGER, SYMBOL_POSITION INTEGER);
    CREATE TABLE ASSETGROUP (uid INTEGER, NAME TEXT);
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

  const group = db.prepare("INSERT INTO ASSETGROUP VALUES (?,?)");
  for (const [uid, name] of [
    [1, "Accounts"],
    [2, "Card"],
    [3, "Debit Card"],
    [4, "Savings"],
    [5, "Loan"],
    [6, "Top-Up/Prepaid"],
    [7, "Others"],
    [8, "Investments"],
    [9, "Overdrafts"],
    [10, "Insurance"],
    [11, "Cash"],
  ] as const) {
    group.run(uid, name);
  }

  const asset = db.prepare("INSERT INTO ASSETS VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  // uid, name, group, currency, order, cardFin, cardPay, cardAsset, memo, ZDATA, ZDATA2
  asset.run("a-bank", "Bancolombia", 1, 1, 0, 0, 0, null, "cuenta nómina", 0, 0);
  asset.run("a-card", "Visa", 2, 1, 1, 15, 5, "a-bank", null, 0, 0);
  asset.run("a-debit", "Débito", 3, 1, 2, 0, 0, null, null, 0, 0);
  asset.run("a-sav", "Ahorros", 4, 1, 3, 0, 0, null, null, 0, 0);
  asset.run("a-loan-neg", "Préstamo banco", 5, 1, 4, 0, 0, null, null, 0, 0);
  asset.run("a-loan-pos", "Presté a Ana", 5, 1, 5, 0, 0, null, null, 0, 0);
  asset.run("a-wallet", "Nequi", 6, 1, 6, 0, 0, null, null, 0, 0);
  asset.run("a-other", "Otros", 7, 1, 7, 0, 0, null, null, 0, 0);
  asset.run("a-inv", "CDT", 8, 1, 8, 0, 0, null, null, 0, 0);
  asset.run("a-over", "Sobregiro", 9, 1, 9, 0, 0, null, null, 0, 0);
  asset.run("a-ins", "Seguro", 10, 1, 10, 0, 0, null, null, 0, 0);
  asset.run("a-cash", "Efectivo", 11, 1, 11, 0, 0, null, null, 0, 0);
  asset.run("a-usd", "US savings", 1, 2, 12, 0, 0, null, null, 0, 0);
  asset.run("a-hidden", "Oculta", 7, 1, 13, 0, 0, null, null, 1, 1);

  const category = db.prepare("INSERT INTO ZCATEGORY VALUES (?,?,?,?,?,?,?)");
  // uid, name, TYPE, pUid, STATUS, C_IS_DEL, order
  category.run("c-food", "🍔 Food", 1, "", 0, 0, 0);
  category.run("c-food-sub", "Supermercado", 1, "c-food", 2, 0, 0);
  category.run("c-salary", "💰 Salary", 0, "", 0, 0, 1);
  category.run("c-guitar", "🎸 Guitarra", 1, "", 0, 0, 2);
  category.run("c-del-unused", "Borrada", 1, "", 0, 1, 3);
  category.run("c-del-used", "Vieja", 1, "", 0, 1, 4);

  const movement = db.prepare("INSERT INTO INOUTCOME VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  // uid, DO_TYPE, WDATE, ZDATE, UTIME, asset, toAsset, ctg, ZMONEY, currency, IN_ZMONEY, AMOUNT_ACCOUNT, txUidTrans, ZCONTENT, ZDATA, IS_DEL
  const feb1 = Date.UTC(2025, 1, 1, 5, 0, 0); // 2025-02-01 00:00 at UTC-5
  movement.run(
    "m1",
    1,
    "2025-01-10",
    Date.UTC(2025, 0, 10, 5),
    0,
    "a-bank",
    "",
    "c-food-sub",
    "50000.0",
    1,
    "50000.0",
    50000,
    "",
    "Almuerzo",
    "",
    0,
  );
  movement.run(
    "m2",
    0,
    "2025-01-15",
    Date.UTC(2025, 0, 15, 5),
    0,
    "a-bank",
    "",
    "c-salary",
    "3000000.0",
    1,
    "3000000.0",
    3000000,
    "",
    "",
    "",
    0,
  );
  movement.run(
    "m3",
    3,
    "2025-02-01",
    feb1,
    0,
    "a-bank",
    "a-usd",
    "",
    "400000.0",
    1,
    "400000.0",
    400000,
    "t1",
    "",
    "",
    0,
  );
  movement.run(
    "m4",
    4,
    "2025-02-01",
    feb1,
    0,
    "a-usd",
    "a-bank",
    "",
    "100.00",
    2,
    "100.00",
    100,
    "t1",
    "",
    "",
    0,
  );
  movement.run(
    "m5",
    1,
    "2025-02-05",
    Date.UTC(2025, 1, 5, 5),
    0,
    "a-bank",
    "",
    "c-food",
    "20.00",
    2,
    "20.00",
    80000,
    "",
    "Dólares",
    "",
    0,
  );
  movement.run(
    "m6",
    7,
    "2025-03-01",
    Date.UTC(2025, 2, 1, 5),
    0,
    "a-cash",
    "",
    "",
    "-10000.0",
    1,
    "-10000.0",
    -10000,
    "",
    "",
    "",
    0,
  );
  movement.run(
    "m7",
    1,
    "2025-03-02",
    Date.UTC(2025, 2, 2, 5),
    0,
    "a-bank",
    "",
    "c-food",
    "0.0",
    1,
    "0.0",
    0,
    "",
    "",
    "",
    0,
  );
  movement.run(
    "m8",
    1,
    "2025-03-02",
    Date.UTC(2025, 2, 2, 5),
    0,
    "a-bank",
    "",
    "c-food",
    "99999.0",
    1,
    "99999.0",
    99999,
    "",
    "",
    "",
    1,
  );
  movement.run(
    "m9",
    1,
    "2025-03-03",
    Date.UTC(2025, 2, 3, 5),
    0,
    "a-bank",
    "",
    "c-del-used",
    "12000.0",
    1,
    "12000.0",
    12000,
    "",
    "",
    "",
    0,
  );
  movement.run(
    "m10",
    1,
    "2025-03-04",
    Date.UTC(2025, 2, 4, 5),
    0,
    "a-loan-neg",
    "",
    "c-food",
    "500000.0",
    1,
    "500000.0",
    500000,
    "",
    "",
    "",
    0,
  );
  movement.run(
    "m11",
    0,
    "2025-03-05",
    Date.UTC(2025, 2, 5, 5),
    0,
    "a-loan-pos",
    "",
    "c-salary",
    "300000.0",
    1,
    "300000.0",
    300000,
    "",
    "",
    "",
    0,
  );

  db.prepare("INSERT INTO TAG VALUES (?,?)").run("t-comida", "comida");
  db.prepare("INSERT INTO TX_TAG VALUES (?,?)").run("m1", "t-comida");
  db.prepare("INSERT INTO BUDGET VALUES (?,?,?)").run("b1", "c-food", 0);
  db.prepare("INSERT INTO ZETC VALUES (?,?)").run("start_day", "1");

  for (const [
    uid,
    doType,
    wdate,
    zdate,
    asset,
    ctg,
    currencyUid,
    inZmoney,
    amountAccount,
    txUidTrans,
  ] of extra) {
    movement.run(
      uid,
      doType,
      wdate,
      zdate,
      0,
      asset,
      "",
      ctg,
      inZmoney,
      currencyUid,
      inZmoney,
      amountAccount,
      txUidTrans,
      "",
      "",
      0,
    );
  }

  if (extraSql !== "") db.exec(extraSql);
  const bytes = db.serialize();
  db.close();
  return bytes;
};

const readOk = (bytes: Uint8Array): SourceSnapshot => {
  const read = new MoneyManagerAdapter().read({ bytes });
  if (isErr(read)) throw new Error(read.error.code);
  return read.value;
};

const errorCode = (read: Result<SourceSnapshot>): string | null => (isErr(read) ? read.error.code : null);

describe("MoneyManagerAdapter (design §1-2)", () => {
  let bytes: Uint8Array;
  let snapshot: SourceSnapshot;

  beforeAll(() => {
    bytes = buildFixture();
    snapshot = readOk(bytes);
  });

  it("detects a Money Manager backup, and nothing else", () => {
    expect(new MoneyManagerAdapter().detect({ bytes })).toBe(true);
    expect(new MoneyManagerAdapter().detect({ bytes: new TextEncoder().encode("this is not sqlite") })).toBe(
      false,
    );
    const other = new DatabaseSync(":memory:");
    other.exec("CREATE TABLE notes (id INTEGER)");
    expect(new MoneyManagerAdapter().detect({ bytes: other.serialize() })).toBe(false);
    other.close();
  });

  it("maps every account group to a Hearth type", () => {
    const type = (id: string) => snapshot.accounts.find((a) => a.sourceId === id)!.type;
    expect(type("a-bank")).toBe("BANK");
    expect(type("a-card")).toBe("CREDIT_CARD");
    expect(type("a-debit")).toBe("BANK");
    expect(type("a-sav")).toBe("SAVINGS");
    expect(type("a-loan-neg")).toBe("LOAN");
    expect(type("a-loan-pos")).toBe("OTHER");
    expect(type("a-wallet")).toBe("WALLET");
    expect(type("a-other")).toBe("OTHER");
    expect(type("a-inv")).toBe("INVESTMENT");
    expect(type("a-over")).toBe("BANK");
    expect(type("a-ins")).toBe("OTHER");
    expect(type("a-cash")).toBe("CASH");
  });

  it("carries the card cut-off and payment days, name, order, memo and currency", () => {
    const card = snapshot.accounts.find((a) => a.sourceId === "a-card")!;
    expect(card).toMatchObject({ name: "Visa", currency: "COP", order: 1, cutOffDay: 15, paymentDay: 5 });
    expect(snapshot.accounts.find((a) => a.sourceId === "a-bank")!.memo).toBe("cuenta nómina");
    expect(snapshot.accounts.find((a) => a.sourceId === "a-usd")!.currency).toBe("USD");
  });

  it("reads the hidden and excluded flags", () => {
    const hidden = snapshot.accounts.find((a) => a.sourceId === "a-hidden")!;
    expect(hidden.hidden).toBe(true);
    expect(hidden.excludedFromTotals).toBe(true);
  });

  it("splits a leading emoji into the category icon and keeps two levels", () => {
    const food = snapshot.categories.find((c) => c.sourceId === "c-food")!;
    expect(food).toMatchObject({ name: "Food", icon: "🍔", kind: "EXPENSE", parentSourceId: null });
    const sub = snapshot.categories.find((c) => c.sourceId === "c-food-sub")!;
    expect(sub).toMatchObject({ name: "Supermercado", parentSourceId: "c-food" });
    expect(snapshot.categories.find((c) => c.sourceId === "c-salary")!.kind).toBe("INCOME");
  });

  it("skips a deleted category nothing uses but keeps one a movement still uses", () => {
    expect(snapshot.categories.find((c) => c.sourceId === "c-del-unused")).toBeUndefined();
    expect(snapshot.categories.find((c) => c.sourceId === "c-del-used")).toMatchObject({ deleted: true });
    expect(snapshot.skipped.deletedCategories).toBe(1);
  });

  it("reads an income and an expense in minor units with the kernel exponent", () => {
    const m1 = snapshot.movements.find((m) => m.sourceKey === "m1")!;
    expect(m1.kind).toBe("EXPENSE");
    // COP's minor unit is the centavo (exponent 2, rounding unit 100), so "50000.0" pesos is 5_000_000 minor units.
    expect(m1.amount.minor).toBe(5000000n);
  });

  it("reads a COP amount into whole-peso minor units", () => {
    const m2 = snapshot.movements.find((m) => m.sourceKey === "m2")!;
    expect(m2.kind).toBe("INCOME");
    expect(m2.amount.currency.code).toBe("COP");
    expect(m2.amount.minor).toBe(300000000n);
  });

  it("pairs the two transfer rows into one movement", () => {
    const transfers = snapshot.movements.filter((m) => m.kind === "TRANSFER");
    expect(transfers).toHaveLength(1);
    const t = transfers[0]!;
    expect(t.sourceKey).toBe("t1");
    expect(t.accountSourceId).toBe("a-bank");
    expect(t.toAccountSourceId).toBe("a-usd");
    expect(t.amount.minor).toBe(40000000n); // 400_000 COP
    expect(t.amount.currency.code).toBe("COP");
    expect(t.toAmount!.minor).toBe(10000n); // 100.00 USD
    expect(t.toAmount!.currency.code).toBe("USD");
  });

  it("keeps a foreign-currency expense in the account currency with its original amount", () => {
    const m5 = snapshot.movements.find((m) => m.sourceKey === "m5")!;
    expect(m5.amount.currency.code).toBe("COP");
    expect(m5.amount.minor).toBe(8000000n); // 80_000 COP from AMOUNT_ACCOUNT
    expect(m5.originalAmount!.currency.code).toBe("USD");
    expect(m5.originalAmount!.minor).toBe(2000n); // 20.00 USD
  });

  it("imports a balance adjustment as its own signed movement", () => {
    const m6 = snapshot.movements.find((m) => m.sourceKey === "m6")!;
    expect(m6.kind).toBe("ADJUSTMENT");
    expect(m6.categorySourceId).toBeNull();
    expect(m6.amount.minor).toBe(-1000000n); // -10_000 COP
  });

  it("skips deleted and zero-amount rows, counting the zeros", () => {
    expect(snapshot.movements.find((m) => m.sourceKey === "m7")).toBeUndefined();
    expect(snapshot.movements.find((m) => m.sourceKey === "m8")).toBeUndefined();
    expect(snapshot.skipped.zeroAmountMovements).toBe(1);
  });

  it("appends tags to the note", () => {
    const m1 = snapshot.movements.find((m) => m.sourceKey === "m1")!;
    expect(m1.note).toBe("Almuerzo #comida");
  });

  it("lists budgets as skipped and keeps the start day setting", () => {
    expect(snapshot.budgets).toHaveLength(1);
    expect(snapshot.settings.startDay).toBe(1);
    expect(snapshot.settings.mainCurrency).toBe("COP");
  });

  it("reports a zip backup as not yet supported", () => {
    const zip = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect(errorCode(new MoneyManagerAdapter().read({ bytes: zip }))).toBe("ZipBackupNotSupported");
  });

  it("refuses a file that is not a SQLite database (design §3.5)", () => {
    const text = new TextEncoder().encode("this is not sqlite");
    expect(errorCode(new MoneyManagerAdapter().read({ bytes: text }))).toBe("ImportFileNotRecognized");
    expect(errorCode(new MoneyManagerAdapter().read({ bytes: new Uint8Array() }))).toBe(
      "ImportFileNotRecognized",
    );
  });

  it("refuses a SQLite database that is not a Money Manager backup", () => {
    const other = new DatabaseSync(":memory:");
    other.exec("CREATE TABLE notes (id INTEGER)");
    const read = new MoneyManagerAdapter().read({ bytes: other.serialize() });
    other.close();
    expect(errorCode(read)).toBe("ImportFileNotRecognized");
  });

  it("refuses a backup whose tables are views, so a crafted query cannot run unbounded", () => {
    const crafted = new DatabaseSync(":memory:");
    crafted.exec(`
      CREATE TABLE ASSETS (uid TEXT);
      CREATE TABLE seed (n INTEGER);
      CREATE VIEW INOUTCOME AS SELECT * FROM seed a, seed b, seed c, seed d;
    `);
    const read = new MoneyManagerAdapter().read({ bytes: crafted.serialize() });
    crafted.close();
    expect(errorCode(read)).toBe("ImportFileNotRecognized");
  });

  it("refuses more than 20 MB before reading it (design §3.5)", () => {
    expect(MAX_IMPORT_BYTES).toBe(20 * 1024 * 1024);
    const big = new Uint8Array(MAX_IMPORT_BYTES + 1);
    big.set(bytes.subarray(0, 16));
    const read = new MoneyManagerAdapter().read({ bytes: big });
    expect(errorCode(read)).toBe("ImportFileTooLarge");
    expect(isErr(read) && read.error.details).toEqual({ maxBytes: MAX_IMPORT_BYTES });
  });

  it("returns a stable error for a SQLite file it cannot read", () => {
    const corrupt = bytes.slice(0, 200);
    expect(errorCode(new MoneyManagerAdapter().read({ bytes: corrupt }))).toBe("UnreadableBackup");
  });

  it("leaves the uploaded bytes as they were", () => {
    const copy = bytes.slice();
    readOk(copy);
    expect(copy).toEqual(bytes);
  });
});

describe("MoneyManagerAdapter row handling (design §2.3, §3.2)", () => {
  const day = Date.UTC(2025, 3, 1, 5);

  it("rounds an account-currency float half to even with the kernel, from its shortest decimal (D29)", () => {
    const snapshot = readOk(
      buildFixture([
        // Entered in COP on the USD account, so the amount is AMOUNT_ACCOUNT (a float) in USD.
        ["f1", 1, "2025-04-01", day, "a-usd", "c-food", 1, "4060.0", 1.015, ""],
        ["f2", 1, "2025-04-01", day, "a-usd", "c-food", 1, "2300.0", 0.575, ""],
        ["f3", 1, "2025-04-01", day, "a-usd", "c-food", 1, "4900.0", 1.225, ""],
        ["f4", 1, "2025-04-01", day, "a-usd", "c-food", 1, "1.0", 1e-7, ""],
        ["f5", 1, "2025-04-01", day, "a-usd", "c-food", 1, "1.0", 1.5e21, ""],
      ]),
    );
    const minor = (key: string) => snapshot.movements.find((m) => m.sourceKey === key)?.amount.minor;
    expect(minor("f1")).toBe(102n);
    expect(minor("f2")).toBe(58n);
    expect(minor("f3")).toBe(122n);
    // 1e-7 dollars rounds to zero cents: skipped and counted like any zero amount.
    expect(minor("f4")).toBeUndefined();
    expect(snapshot.skipped.zeroAmountMovements).toBe(2);
    expect(minor("f5")).toBe(150000000000000000000000n);
  });

  it("turns a malformed amount or date into a row error and still reads the other rows", () => {
    const snapshot = readOk(
      buildFixture([
        ["bad-amount", 1, "2025-04-01", day, "a-bank", "c-food", 1, "12.345", 12.345, ""],
        ["bad-date", 1, "2025-13-40", day, "a-bank", "c-food", 1, "1000.0", 1000, ""],
        ["bad-float", 1, "2025-04-01", day, "a-usd", "c-food", 1, "1000.0", Number.NaN, ""],
      ]),
    );
    expect(snapshot.errors).toEqual([
      { code: "InvalidMoneyPrecision", sourceKey: "bad-amount", details: { value: "12.345" } },
      { code: "InvalidDate", sourceKey: "bad-date", details: { value: "2025-13-40" } },
      { code: "InvalidMoneyPrecision", sourceKey: "bad-float", details: { value: "NaN" } },
    ]);
    expect(snapshot.movements.map((m) => m.sourceKey)).toContain("m1");
    expect(snapshot.movements.find((m) => m.sourceKey.startsWith("bad-"))).toBeUndefined();
  });

  it("reports warnings as codes with the row's key, never as sentences", () => {
    const snapshot = readOk(
      buildFixture([
        ["orphan", 1, "2025-04-01", day, "a-missing", "c-food", 1, "1000.0", 1000, ""],
        ["half", 3, "2025-04-01", day, "a-bank", "", 1, "1000.0", 1000, "t-half"],
      ]),
    );
    expect(snapshot.warnings).toEqual([
      { code: "MovementWithoutAccount", sourceKey: "orphan" },
      { code: "TransferIncomplete", sourceKey: "t-half" },
    ]);
  });

  it("keys a transfer row without txUidTrans by its own uid, so such rows never pair up", () => {
    const snapshot = readOk(
      buildFixture([
        ["lone-out", 3, "2025-04-01", day, "a-bank", "", 1, "1000.0", 1000, ""],
        ["lone-in", 4, "2025-04-01", day, "a-cash", "", 1, "1000.0", 1000, ""],
        ["lone-out-2", 3, "2025-04-01", day, "a-sav", "", 1, "2000.0", 2000, ""],
      ]),
    );
    expect(snapshot.movements.filter((m) => m.kind === "TRANSFER").map((m) => m.sourceKey)).toEqual(["t1"]);
    expect(snapshot.warnings).toEqual([
      { code: "TransferIncomplete", sourceKey: "lone-out" },
      { code: "TransferIncomplete", sourceKey: "lone-in" },
      { code: "TransferIncomplete", sourceKey: "lone-out-2" },
    ]);
  });

  it("skips a transfer with only one side at zero, with a warning, instead of keeping a zero amount", () => {
    const snapshot = readOk(
      buildFixture([
        ["z-out", 3, "2025-04-01", day, "a-bank", "", 1, "1000.0", 1000, "t-zero-in"],
        ["z-in", 4, "2025-04-01", day, "a-cash", "", 1, "0.0", 0, "t-zero-in"],
        ["y-out", 3, "2025-04-01", day, "a-bank", "", 1, "0.0", 0, "t-zero-out"],
        ["y-in", 4, "2025-04-01", day, "a-cash", "", 1, "500.0", 500, "t-zero-out"],
      ]),
    );
    expect(snapshot.movements.find((m) => m.sourceKey.startsWith("t-zero"))).toBeUndefined();
    expect(snapshot.warnings).toEqual([
      { code: "TransferOneSideZero", sourceKey: "t-zero-in" },
      { code: "TransferOneSideZero", sourceKey: "t-zero-out" },
    ]);
    expect(snapshot.skipped.zeroAmountMovements).toBe(1);
  });

  it("reads tags without joining the upload's tables, once each and at most ten per movement", () => {
    const sameTag = Array.from({ length: 60 }, () => "('tg-same', 'repeated')").join(",");
    const links = Array.from({ length: 60 }, () => "('m1', 'tg-same')").join(",");
    const many = Array.from({ length: 15 }, (_, i) => `('tg-${i}', 'tag${i}')`).join(",");
    const manyLinks = Array.from({ length: 15 }, (_, i) => `('m2', 'tg-${i}')`).join(",");
    const snapshot = readOk(
      buildFixture(
        [],
        `INSERT INTO TAG VALUES ${sameTag}, ${many}; INSERT INTO TX_TAG VALUES ${links}, ${manyLinks};`,
      ),
    );
    const note = (key: string) => snapshot.movements.find((m) => m.sourceKey === key)?.note ?? "";
    expect(note("m1").match(/#repeated/g)).toHaveLength(1);
    expect(note("m2").match(/#tag\d+/g)).toHaveLength(10);
    expect(snapshot.warnings).toContainEqual({
      code: "TagsTruncated",
      sourceKey: "m2",
      details: { leftOut: "5" },
    });
    expect(snapshot.warnings.find((w) => w.code === "TagsTruncated" && w.sourceKey === "m1")).toBeUndefined();
  });

  it("reports a movement type it does not know as a row error, never as a balance adjustment", () => {
    const snapshot = readOk(
      buildFixture([["odd-type", 9, "2025-04-01", day, "a-bank", "", 1, "1000.0", 1000, ""]]),
    );
    expect(snapshot.errors).toContainEqual({
      code: "UnknownMovementType",
      sourceKey: "odd-type",
      details: { doType: "9" },
    });
    expect(snapshot.movements.find((m) => m.sourceKey === "odd-type")).toBeUndefined();
  });

  it("reports an account in a currency it does not know as a row error and still reads the rest", () => {
    const snapshot = readOk(
      buildFixture(
        [["on-odd", 1, "2025-04-01", day, "a-odd", "c-food", 1, "1000.0", 1000, ""]],
        "INSERT INTO ASSETS VALUES ('a-odd', 'Odd', 1, 99, 50, 0, 0, '', '', 0, 0);",
      ),
    );
    expect(snapshot.errors).toContainEqual(
      expect.objectContaining({ code: "UnknownCurrency", sourceKey: "a-odd" }),
    );
    expect(snapshot.accounts.find((a) => a.sourceId === "a-odd")).toBeUndefined();
    expect(snapshot.warnings).toContainEqual({ code: "MovementWithoutAccount", sourceKey: "on-odd" });
    expect(snapshot.movements.map((m) => m.sourceKey)).toContain("m1");
  });

  it("drops a transfer to or from an account in an unknown currency with a warning, and keeps the rest", () => {
    const snapshot = readOk(
      buildFixture(
        [
          ["x-out", 3, "2025-04-01", day, "a-bank", "", 1, "1000.0", 1000, "t-odd"],
          ["x-in", 4, "2025-04-01", day, "a-odd", "", 1, "1000.0", 1000, "t-odd"],
        ],
        "INSERT INTO ASSETS VALUES ('a-odd', 'Odd', 1, 99, 50, 0, 0, '', '', 0, 0);",
      ),
    );
    expect(snapshot.warnings).toContainEqual({ code: "TransferWithoutAccount", sourceKey: "t-odd" });
    expect(snapshot.movements.find((m) => m.sourceKey === "t-odd")).toBeUndefined();
    expect(snapshot.movements.filter((m) => m.kind === "TRANSFER").map((m) => m.sourceKey)).toEqual(["t1"]);
  });

  it("keeps a movement whose instant is out of range, without the instant and with a warning", () => {
    const snapshot = readOk(
      buildFixture([["far", 1, "2025-04-01", 9e15, "a-bank", "c-food", 1, "1000.0", 1000, ""]]),
    );
    expect(snapshot.movements.find((m) => m.sourceKey === "far")?.occurredAt).toBeNull();
    expect(snapshot.warnings).toContainEqual({ code: "InvalidInstant", sourceKey: "far" });
  });
});

describe("Money Manager's real tables (owner's import of 2026-11-16)", () => {
  /** A backup built from Money Manager's own table definitions, with one row per read table, every column named. */
  const realBackup = (): Uint8Array => {
    const db = new DatabaseSync(":memory:");
    for (const table of MONEY_MANAGER_TABLES) db.exec(table);
    db.exec(`
      INSERT INTO CURRENCY (uid, ISO, MAIN_ISO, IS_MAIN_CURRENCY, IS_DEL) VALUES ('COP_COP', 'COP', 'COP', 1, 0);
      INSERT INTO CURRENCY (uid, ISO, MAIN_ISO, IS_MAIN_CURRENCY, IS_DEL) VALUES ('COP_USD', 'USD', 'COP', 0, 0);
      INSERT INTO ASSETS (uid, NIC_NAME, groupUid, currencyUid, ORDERSEQ) VALUES ('a-bank', 'Banco', 1, 'COP_COP', 0);
      INSERT INTO ASSETS (uid, NIC_NAME, groupUid, currencyUid, ORDERSEQ) VALUES ('a-usd', 'Dólares', 1, 'COP_USD', 1);
      INSERT INTO ZCATEGORY (uid, NAME, TYPE, pUid, STATUS, C_IS_DEL, ORDERSEQ) VALUES ('c-food', 'Comida', 1, '', 0, 0, 0);
      INSERT INTO INOUTCOME (uid, DO_TYPE, WDATE, ZDATE, UTIME, assetUid, ctgUid, ZMONEY, currencyUid, IN_ZMONEY,
        AMOUNT_ACCOUNT, txUidTrans, ZCONTENT, IS_DEL)
        VALUES ('m1', 1, '2025-01-10', ${Date.UTC(2025, 0, 10, 5)}, 0, 'a-bank', 'c-food', '50000.0', 'COP_COP', '50000.0',
          50000, '', 'Almuerzo', 0);
      INSERT INTO TAG (uid, name) VALUES ('t1', 'comida');
      INSERT INTO TX_TAG (txUid, tagUid) VALUES ('m1', 't1');
      INSERT INTO BUDGET (uid, targetUid, IS_DEL) VALUES ('b1', 'c-food', 0);
      INSERT INTO ZETC (dataTypeKey, ZDATA) VALUES ('start_day', '1');
    `);
    const bytes = db.serialize();
    db.close();
    return bytes;
  };

  it("reads a backup whose tables are Money Manager's own, not only the synthetic ones", () => {
    const result = new MoneyManagerAdapter().read({ bytes: realBackup() });
    expect(isErr(result) ? result.error : null).toBeNull();
    const snapshot = (result as { value: SourceSnapshot }).value;
    expect(snapshot.accounts.map((account) => account.name)).toEqual(["Banco", "Dólares"]);
    expect(snapshot.movements).toHaveLength(1);
  });

  it("keeps each account's own currency: Money Manager's currency ids are text such as COP_COP and COP_USD", () => {
    // Owner's import of 2026-11-16: read as numbers, both ids collapsed into one, every account came out in USD and
    // every movement then waited on a USD to COP rate, so none was imported.
    const snapshot = (new MoneyManagerAdapter().read({ bytes: realBackup() }) as { value: SourceSnapshot })
      .value;
    expect(snapshot.accounts.map((account) => [account.name, account.currency])).toEqual([
      ["Banco", "COP"],
      ["Dólares", "USD"],
    ]);
    expect(snapshot.movements.map((movement) => movement.amount.currency.code)).toEqual(["COP"]);
    expect(snapshot.settings.mainCurrency).toBe("COP");
  });
});

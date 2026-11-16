import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isErr, isOk } from "@/shared/kernel";
import type { SourceSnapshot } from "../domain/source-snapshot";
import { MoneyManagerAdapter } from "./money-manager-adapter";

/** Builds a tiny, synthetic Money Manager SQLite backup covering every mapping rule. No real or personal data. */
const buildFixture = (path: string): void => {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE CURRENCY (uid INTEGER, ISO TEXT, MAIN_ISO TEXT, IS_MAIN_CURRENCY INTEGER, RATE TEXT, DECIMAL_POINT INTEGER, SYMBOL_POSITION INTEGER);
    CREATE TABLE ASSETGROUP (uid INTEGER, NAME TEXT);
    CREATE TABLE ASSETS (uid TEXT, NIC_NAME TEXT, groupUid INTEGER, currencyUid INTEGER, ORDERSEQ INTEGER, CARD_DAY_FIN INTEGER, CARD_DAY_PAY INTEGER, cardAssetUid TEXT, ZDATA1 TEXT, ZDATA INTEGER, ZDATA2 INTEGER);
    CREATE TABLE ZCATEGORY (uid TEXT, NAME TEXT, TYPE INTEGER, pUid TEXT, STATUS INTEGER, C_IS_DEL INTEGER, ORDERSEQ INTEGER);
    CREATE TABLE INOUTCOME (uid TEXT, DO_TYPE INTEGER, WDATE TEXT, ZDATE INTEGER, UTIME INTEGER, assetUid TEXT, toAssetUid TEXT, ctgUid TEXT, ZMONEY TEXT, currencyUid INTEGER, IN_ZMONEY TEXT, AMOUNT_ACCOUNT REAL, txUidTrans TEXT, ZCONTENT TEXT, ZDATA TEXT, IS_DEL INTEGER);
    CREATE TABLE TAG (uid TEXT, NAME TEXT);
    CREATE TABLE TX_TAG (txUid TEXT, tagUid TEXT);
    CREATE TABLE BUDGET (uid TEXT, ctgUid TEXT, BUDGET_PERIOD INTEGER);
    CREATE TABLE ZETC (dataTypeKey TEXT, VALUE TEXT);
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

  db.close();
};

describe("MoneyManagerAdapter (design §1-2)", () => {
  let dir: string;
  let file: string;
  let snapshot: SourceSnapshot;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "mm-fixture-"));
    file = join(dir, "backup.sqlite");
    buildFixture(file);
    const read = new MoneyManagerAdapter().read({ path: file });
    if (isErr(read)) throw new Error(read.error.code);
    snapshot = read.value;
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("detects a Money Manager backup", () => {
    expect(new MoneyManagerAdapter().detect({ path: file })).toBe(true);
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
    const zip = join(dir, "backup.mmbak");
    writeFileSync(zip, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]));
    const read = new MoneyManagerAdapter().read({ path: zip });
    expect(isErr(read)).toBe(true);
    if (isErr(read)) expect(read.error.code).toBe("ZipBackupNotSupported");
  });

  it("returns a stable error for an unreadable file", () => {
    const bad = join(dir, "not-a-db.sqlite");
    writeFileSync(bad, "this is not sqlite");
    const read = new MoneyManagerAdapter().read({ path: bad });
    expect(isErr(read)).toBe(true);
    if (isErr(read)) expect(read.error.code).toBe("UnreadableBackup");
    expect(isOk(read)).toBe(false);
  });
});

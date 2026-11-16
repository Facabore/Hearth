import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { PATCH as adjustImport } from "@/app/api/v1/spaces/[spaceId]/imports/[importId]/route";
import { POST as confirmImport } from "@/app/api/v1/spaces/[spaceId]/imports/[importId]/confirm/route";
import { POST as undoImport } from "@/app/api/v1/spaces/[spaceId]/imports/[importId]/undo/route";
import { GET as listImports, POST as startImport } from "@/app/api/v1/spaces/[spaceId]/imports/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, routeParams, startTestApp, type TestUser } from "../support/app";
import { categoryWithKey, cop, newAccount, post, starterAccount } from "../support/ledger";
import { moneyManagerBackup } from "../support/money-manager-backup";
import { joinAs, newSharedSpace } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp({ clock: new FixedClock(new Date("2026-11-16T15:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const backup = moneyManagerBackup();

/** Uploads `bytes` as the multipart field `file`, as the SPA's file picker sends it. */
const upload = (user: TestUser, bytes: Uint8Array, spaceId = user.spaceId) => {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(bytes)]), "money_android.sqlite");
  return startImport(
    new Request(`http://localhost:3000/api/v1/spaces/${spaceId}/imports`, {
      method: "POST",
      headers: { cookie: user.cookie },
      body: form,
    }),
    routeParams({ spaceId }),
  );
};

interface Preview {
  id: string;
  status: string;
  previouslyImportedAt: string | null;
  counts: Record<string, number>;
  accounts: {
    sourceId: string;
    mapping: { kind: string; accountId?: string; type?: string; currency?: string };
  }[];
  categories: {
    sourceId: string;
    catalogKey: string | null;
    mapping: { kind: string; categoryId?: string };
  }[];
  duplicates: string[];
  plan: {
    movements: number;
    alreadyImported: string[];
    duplicatesSkipped: number;
    adjustmentsInOpeningBalance: number;
    adjustmentsNotImported: number;
  };
}

interface Result {
  status: string;
  counts: Record<string, number>;
  rowErrors: { code: string; sourceKey: string }[];
}

const uploaded = async (user: TestUser): Promise<Preview> => {
  const response = await upload(user, backup);
  expect(response.status).toBe(201);
  return (await response.json()) as Preview;
};

const importPath = (user: TestUser, importId: string, action = "") =>
  `/api/v1/spaces/${user.spaceId}/imports/${importId}${action}`;

const confirm = (user: TestUser, importId: string, key = crypto.randomUUID()) =>
  call(confirmImport, "POST", importPath(user, importId, "/confirm"), {
    user,
    params: { spaceId: user.spaceId, importId },
    headers: { "idempotency-key": key },
  });

const confirmed = async (user: TestUser, importId: string): Promise<Result> => {
  const response = await confirm(user, importId);
  expect(response.status).toBe(200);
  return (await response.json()) as Result;
};

/** Uploads the default backup and confirms it as proposed. */
const imported = async (user: TestUser): Promise<{ preview: Preview; result: Result }> => {
  const preview = await uploaded(user);
  return { preview, result: await confirmed(user, preview.id) };
};

const liveMovements = async (spaceId: string): Promise<number> =>
  Number(
    (
      await app.pool.query("SELECT count(*) FROM transactions WHERE space_id = $1 AND deleted_at IS NULL", [
        spaceId,
      ])
    ).rows[0].count,
  );

const accountNamed = async (spaceId: string, name: string) =>
  (await app.pool.query("SELECT * FROM accounts WHERE space_id = $1 AND name = $2", [spaceId, name]))
    .rows[0] as Record<string, unknown> | undefined;

const EVERY_ROW = ["m1", "m2", "t1", "m5", "m6", "m7"];

describe("POST /api/v1/spaces/{spaceId}/imports (D28, design §3.2)", () => {
  it("answers the preview: counts, proposed mappings and the plan, with nothing in the ledger", async () => {
    const ana = await registerUser("Ana");
    const preview = await uploaded(ana);

    expect(preview).toMatchObject({ status: "DRAFT", previouslyImportedAt: null });
    expect(preview.counts).toMatchObject({ income: 1, expense: 4, transfer: 1, adjustment: 2, total: 8 });
    const mappings = Object.fromEntries(preview.accounts.map((a) => [a.sourceId, a.mapping]));
    expect(mappings).toEqual({
      "a-cash": { kind: "existing", accountId: await starterAccount(ana, "Efectivo") },
      "a-bank": { kind: "new", type: "BANK", currency: "COP", name: "Banco Uno" },
      "a-usd": { kind: "new", type: "BANK", currency: "USD", name: "US savings" },
      "a-card": { kind: "new", type: "CREDIT_CARD", currency: "COP", name: "Visa" },
    });
    const categories = Object.fromEntries(preview.categories.map((c) => [c.sourceId, c.mapping]));
    expect(categories["c-food"]).toEqual({
      kind: "existing",
      categoryId: await categoryWithKey(ana, "groceries"),
    });
    expect(categories["c-salary"]).toEqual({
      kind: "existing",
      categoryId: await categoryWithKey(ana, "salary"),
    });
    expect(categories["c-guitar"]).toMatchObject({ kind: "new" });
    expect(categories["c-food-sub"]).toEqual({ kind: "new", groupId: null, name: "Supermercado" });
    expect(preview.plan).toEqual({
      movements: 6,
      alreadyImported: [],
      duplicatesSkipped: 0,
      adjustmentsInOpeningBalance: 1,
      adjustmentsNotImported: 1,
    });
    expect(await liveMovements(ana.spaceId)).toBe(0);
  });

  it("refuses a file over 20 MB with 422 ImportFileTooLarge, before reading it", async () => {
    const ana = await registerUser("Ana");
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(backup);
    const refused = await upload(ana, big);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "ImportFileTooLarge", maxBytes: 20 * 1024 * 1024 });
  });

  it("refuses a file that is not a Money Manager backup with 422 ImportFileNotRecognized", async () => {
    const ana = await registerUser("Ana");
    expect(await problemOf(await upload(ana, new TextEncoder().encode("hola")))).toEqual([
      422,
      "ImportFileNotRecognized",
    ]);
  });

  it("answers 422 ImportTimedOut when the file's reads outlast the time limit", async () => {
    const ana = await registerUser("Ana");
    const hasty = startTestApp({ importTimeoutMs: 0 });
    try {
      expect(await problemOf(await upload(ana, backup))).toEqual([422, "ImportTimedOut"]);
    } finally {
      setContainerForTests(app);
      await hasty.pool.end();
    }
  });

  it("refuses a VIEWER with 403, and a shared space with 409 ImportRequiresPersonalSpace", async () => {
    const ana = await registerUser("Ana");
    const sofi = await registerUser("Sofi");
    const household = await newSharedSpace(ana);
    await joinAs(ana, household, sofi, "VIEWER");
    expect(await problemOf(await upload(sofi, backup, household))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await upload(ana, backup, household))).toEqual([
      409,
      "ImportRequiresPersonalSpace",
    ]);
  });

  it("answers 401 without a session", async () => {
    const form = new FormData();
    form.set("file", new Blob([new Uint8Array(backup)]));
    const response = await startImport(
      new Request("http://localhost:3000/api/v1/spaces/x/imports", { method: "POST", body: form }),
      routeParams({ spaceId: "x" }),
    );
    expect(await problemOf(response)).toEqual([401, "Unauthenticated"]);
  });
});

describe("POST /api/v1/spaces/{spaceId}/imports/{importId}/confirm (D28, design §3.2)", () => {
  it("creates the accounts and categories and records every movement with its minor units, date and time", async () => {
    const ana = await registerUser("Ana");
    const { result } = await imported(ana);

    expect(result).toEqual({
      id: expect.any(String),
      status: "CONFIRMED",
      counts: {
        accountsCreated: 3,
        accountsRestored: 0,
        categoriesCreated: 2,
        categoriesRestored: 0,
        movementsImported: 5,
        alreadyImported: 0,
        duplicatesSkipped: 0,
        adjustmentsInOpeningBalance: 1,
        adjustmentsNotImported: 1,
        rowErrors: 1,
      },
      // A USD expense from the USD account needs a USD→COP rate for its date, and there is none: that row only.
      rowErrors: [expect.objectContaining({ code: "ExchangeRateRequired", sourceKey: "m6" })],
    });

    const bank = await accountNamed(ana.spaceId, "Banco Uno");
    // Gap G1: the adjustment before the account's first movement is its opening balance, 50,000.00 COP.
    expect(bank).toMatchObject({ type: "BANK", currency: "COP", opening_balance: "5000000" });
    expect(await accountNamed(ana.spaceId, "US savings")).toMatchObject({ currency: "USD" });
    expect(await accountNamed(ana.spaceId, "Visa")).toMatchObject({
      type: "CREDIT_CARD",
      cut_off_day: 15,
      payment_day: 5,
    });

    const { rows } = await app.pool.query(
      `SELECT type, description, date::text, occurred_at, time_zone, amount, currency, original_amount, original_currency,
              source_amount, destination_amount, destination_currency
         FROM transactions WHERE space_id = $1 AND deleted_at IS NULL ORDER BY date, type`,
      [ana.spaceId],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        type: "EXPENSE",
        description: "Almuerzo",
        date: "2025-01-10",
        occurred_at: new Date("2025-01-10T15:30:00Z"),
        time_zone: "America/Bogota",
        amount: "5000000",
        currency: "COP",
        original_amount: null,
      }),
      expect.objectContaining({ type: "INCOME", date: "2025-01-15", amount: "300000000" }),
      expect.objectContaining({ type: "EXPENSE", date: "2025-01-20", amount: "1200000" }),
      // 400,000.00 COP left the bank and 100.00 USD reached the USD account (D29, 4.1).
      expect.objectContaining({
        type: "TRANSFER",
        date: "2025-02-01",
        amount: "40000000",
        source_amount: null,
        destination_amount: "10000",
        destination_currency: "USD",
      }),
      // 20.00 USD charged as 80,000.00 COP on the COP bank: the base is what the bank charged, the original kept.
      expect.objectContaining({
        type: "EXPENSE",
        date: "2025-02-05",
        amount: "8000000",
        original_amount: "2000",
        original_currency: "USD",
      }),
    ]);
  });

  it("imports nothing twice when the same file is uploaded and confirmed again, and says it was imported before", async () => {
    const ana = await registerUser("Ana");
    await imported(ana);
    const before = await liveMovements(ana.spaceId);

    const again = await uploaded(ana);
    expect(again.previouslyImportedAt).toBe("2026-11-16T15:00:00.000Z");
    expect(again.plan.alreadyImported.sort()).toEqual(["adj0", "m1", "m2", "m5", "m7", "t1"]);
    expect(again.accounts.every((a) => a.mapping.kind === "existing")).toBe(true);
    const result = await confirmed(ana, again.id);

    expect(result.counts).toMatchObject({
      accountsCreated: 0,
      categoriesCreated: 0,
      movementsImported: 0,
      alreadyImported: 6,
      rowErrors: 1,
    });
    expect(await liveMovements(ana.spaceId)).toBe(before);
  });

  it("never brings back a movement the person deleted in Hearth after the import", async () => {
    const ana = await registerUser("Ana");
    await imported(ana);
    const { rows } = await app.pool.query(
      "SELECT id FROM transactions WHERE space_id = $1 AND description = 'Almuerzo'",
      [ana.spaceId],
    );
    const deleted = await app.ledger.deleteTransaction({
      spaceId: ana.spaceId,
      userId: ana.userId,
      transactionId: rows[0].id,
    });
    expect(deleted.ok).toBe(true);
    const before = await liveMovements(ana.spaceId);

    const result = await confirmed(ana, (await uploaded(ana)).id);

    expect(result.counts.movementsImported).toBe(0);
    expect(await liveMovements(ana.spaceId)).toBe(before);
  });

  it("skips a likely duplicate of a movement already in Hearth unless the person includes it", async () => {
    const ana = await registerUser("Ana");
    const cash = await starterAccount(ana, "Efectivo");
    const typed = await post(recordExpense, ana, "expenses", {
      description: "Clase",
      date: "2025-01-20",
      categoryId: await categoryWithKey(ana, "groceries"),
      amount: cop(12_000),
      accountId: cash,
    });
    expect(typed.status).toBe(201);

    const preview = await uploaded(ana);
    expect(preview.duplicates).toEqual(["m7"]);
    expect(preview.plan.duplicatesSkipped).toBe(1);
    const included = await call(adjustImport, "PATCH", importPath(ana, preview.id), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
      body: { includeDuplicates: ["m7"] },
    });
    expect(included.status).toBe(200);
    expect(((await included.json()) as Preview).plan.duplicatesSkipped).toBe(0);

    const result = await confirmed(ana, preview.id);
    expect(result.counts).toMatchObject({ movementsImported: 5, duplicatesSkipped: 0 });
  });

  it("finds a likely duplicate transfer by what reached an account already in Hearth", async () => {
    const ana = await registerUser("Ana");
    const cash = await starterAccount(ana, "Efectivo");
    const typed = await post(recordTransfer, ana, "transfers", {
      date: "2025-01-25",
      amount: cop(20_000),
      sourceAccountId: await starterAccount(ana, "Cuenta bancaria"),
      destinationAccountId: cash,
    });
    expect(typed.status).toBe(201);
    const leg = {
      wdate: "2025-01-25",
      zdate: Date.UTC(2025, 0, 25, 15),
      currency: 1 as const,
      txUidTrans: "t2",
    };
    const withTransfer = moneyManagerBackup([
      {
        ...leg,
        uid: "m20",
        doType: 3,
        asset: "a-bank",
        toAsset: "a-cash",
        entered: "20000.0",
        inAccount: 20000,
      },
      {
        ...leg,
        uid: "m21",
        doType: 4,
        asset: "a-cash",
        toAsset: "a-bank",
        entered: "20000.0",
        inAccount: 20000,
      },
    ]);

    const response = await upload(ana, withTransfer);

    expect(((await response.json()) as Preview).duplicates).toEqual(["t2"]);
  });

  it("refuses a second confirm of the same draft with 409 ImportNotDraft", async () => {
    const ana = await registerUser("Ana");
    const { preview } = await imported(ana);
    expect(await problemOf(await confirm(ana, preview.id))).toEqual([409, "ImportNotDraft"]);
  });

  it("answers 404 ImportNotFound for another person's import", async () => {
    const ana = await registerUser("Ana");
    const luis = await registerUser("Luis");
    const preview = await uploaded(ana);
    const response = await call(confirmImport, "POST", importPath(luis, preview.id, "/confirm"), {
      user: luis,
      params: { spaceId: luis.spaceId, importId: preview.id },
    });
    expect(await problemOf(response)).toEqual([404, "ImportNotFound"]);
  });
});

describe("PATCH /api/v1/spaces/{spaceId}/imports/{importId} (D28, design §3.2)", () => {
  it("maps a source account to an existing account of the same currency, and refuses one in another", async () => {
    const ana = await registerUser("Ana");
    const preview = await uploaded(ana);
    const bank = await starterAccount(ana, "Cuenta bancaria");
    const adjust = (body: unknown) =>
      call(adjustImport, "PATCH", importPath(ana, preview.id), {
        user: ana,
        params: { spaceId: ana.spaceId, importId: preview.id },
        body,
      });

    const mapped = await adjust({ accounts: { "a-bank": { kind: "existing", accountId: bank } } });
    expect(mapped.status).toBe(200);
    const view = (await mapped.json()) as Preview;
    expect(view.accounts.find((a) => a.sourceId === "a-bank")?.mapping).toEqual({
      kind: "existing",
      accountId: bank,
    });
    // An existing account keeps its own opening balance: the early adjustment waits for the ADJUSTMENT type.
    expect(view.plan).toMatchObject({ adjustmentsInOpeningBalance: 0, adjustmentsNotImported: 2 });

    const refused = await adjust({ accounts: { "a-usd": { kind: "existing", accountId: bank } } });
    expect(refused.status).toBe(422);
    // The client learns which source account and why, to word it (design §3.2).
    expect(await refused.json()).toMatchObject({
      code: "InvalidImportMapping",
      reason: "currencyMismatch",
      sourceId: "a-usd",
    });
    expect(await problemOf(await adjust({ timeZone: "Mars/Olympus" }))).toEqual([422, "InvalidTimeZone"]);
  });
});

describe("POST /api/v1/spaces/{spaceId}/imports/{importId}/undo (D28, design §3.2)", () => {
  it("deletes logically every movement the import created, archives what it created, and lets a re-import bring it back", async () => {
    const ana = await registerUser("Ana");
    const cash = await starterAccount(ana, "Efectivo");
    const { preview } = await imported(ana);

    const response = await call(undoImport, "POST", importPath(ana, preview.id, "/undo"), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: preview.id,
      status: "UNDONE",
      movementsDeleted: 5,
      accountsArchived: 3,
      categoriesArchived: 2,
    });
    expect(await liveMovements(ana.spaceId)).toBe(0);
    const { rows } = await app.pool.query(
      "SELECT count(*) FROM transactions WHERE space_id = $1 AND deleted_at IS NOT NULL",
      [ana.spaceId],
    );
    expect(Number(rows[0].count)).toBe(5);
    expect((await accountNamed(ana.spaceId, "Banco Uno"))?.archived_at).not.toBeNull();
    // The starter account the import only used stays as it was.
    expect((await accountNamed(ana.spaceId, "Efectivo"))?.id).toBe(cash);
    expect((await accountNamed(ana.spaceId, "Efectivo"))?.archived_at).toBeNull();

    const history = await call(listImports, "GET", `/api/v1/spaces/${ana.spaceId}/imports`, {
      user: ana,
      params: { spaceId: ana.spaceId },
    });
    expect(history.status).toBe(200);
    expect(((await history.json()) as { items: { id: string; status: string }[] }).items).toEqual([
      expect.objectContaining({ id: preview.id, status: "UNDONE", undoneAt: "2026-11-16T15:00:00.000Z" }),
    ]);

    const again = await uploaded(ana);
    expect(again.previouslyImportedAt).toBeNull();
    expect(again.plan.alreadyImported).toEqual([]);
    expect(again.plan.movements).toBe(EVERY_ROW.length);
  });

  it("counts only the movements it deleted, never one the person had deleted already", async () => {
    const ana = await registerUser("Ana");
    const { preview } = await imported(ana);
    const { rows } = await app.pool.query(
      "SELECT id FROM transactions WHERE space_id = $1 AND description = 'Almuerzo'",
      [ana.spaceId],
    );
    await app.ledger.deleteTransaction({
      spaceId: ana.spaceId,
      userId: ana.userId,
      transactionId: rows[0].id,
    });

    const response = await call(undoImport, "POST", importPath(ana, preview.id, "/undo"), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
    });

    expect(await response.json()).toMatchObject({ status: "UNDONE", movementsDeleted: 4 });
    expect(await liveMovements(ana.spaceId)).toBe(0);
  });

  it("refuses to undo a draft with 409 ImportNotConfirmed", async () => {
    const ana = await registerUser("Ana");
    const preview = await uploaded(ana);
    const response = await call(undoImport, "POST", importPath(ana, preview.id, "/undo"), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
    });
    expect(await problemOf(response)).toEqual([409, "ImportNotConfirmed"]);
  });
});

describe("a re-import after an undo, and names the space already holds (D28, design §3.3)", () => {
  const undo = (user: TestUser, importId: string) =>
    call(undoImport, "POST", importPath(user, importId, "/undo"), {
      user,
      params: { spaceId: user.spaceId, importId },
    });

  it("confirms the same file again after an undo, restoring the accounts and categories the undo archived", async () => {
    const ana = await registerUser("Ana");
    const { preview } = await imported(ana);
    const bank = await accountNamed(ana.spaceId, "Banco Uno");
    expect((await undo(ana, preview.id)).status).toBe(200);

    const again = await uploaded(ana);
    expect(again.accounts.find((a) => a.sourceId === "a-bank")?.mapping).toEqual({
      kind: "existing",
      accountId: bank?.id,
    });
    const result = await confirmed(ana, again.id);

    expect(result.counts).toMatchObject({
      accountsCreated: 0,
      accountsRestored: 3,
      categoriesCreated: 0,
      categoriesRestored: 2,
      movementsImported: 5,
    });
    expect(await accountNamed(ana.spaceId, "Banco Uno")).toMatchObject({ id: bank?.id, archived_at: null });
    expect(await liveMovements(ana.spaceId)).toBe(5);
  });

  it("gives a new account or category a name no archived one holds, and says so in the preview", async () => {
    const ana = await registerUser("Ana");
    const archived = await newAccount(ana, "banco uno", 0, "SAVINGS");
    await app.accounts.archiveAccount({ spaceId: ana.spaceId, userId: ana.userId, accountId: archived });
    const otros = (
      await app.pool.query("SELECT id FROM category_groups WHERE space_id = $1 AND key = 'other'", [
        ana.spaceId,
      ])
    ).rows[0].id as string;
    const guitar = await app.categories.createCategory({
      spaceId: ana.spaceId,
      userId: ana.userId,
      groupId: otros,
      name: "Guitarra",
    });
    if (!guitar.ok) throw new Error(guitar.error.code);
    await app.categories.archiveCategory({
      spaceId: ana.spaceId,
      userId: ana.userId,
      categoryId: guitar.value.id,
    });

    const preview = await uploaded(ana);
    expect(preview.accounts.find((a) => a.sourceId === "a-bank")?.mapping).toEqual({
      kind: "new",
      type: "BANK",
      currency: "COP",
      name: "Banco Uno (Money Manager)",
    });
    expect(preview.categories.find((c) => c.sourceId === "c-guitar")?.mapping).toEqual({
      kind: "new",
      groupId: otros,
      name: "Guitarra (Money Manager)",
    });
    const result = await confirmed(ana, preview.id);

    expect(result.counts).toMatchObject({ accountsCreated: 3, categoriesCreated: 2, movementsImported: 5 });
    expect(await accountNamed(ana.spaceId, "Banco Uno (Money Manager)")).toMatchObject({ archived_at: null });
  });
});

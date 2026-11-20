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
import { GET as directBalance } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { moneyManagerBackup, type BackupMovement } from "../support/money-manager-backup";
import { addLine, lineNamed, newPlan, putCategories, setCapacities } from "../support/budgeting";
import { defined } from "../support/recurrences";
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

const MB = 1024 * 1024;

/** A request body of `total` zero bytes in 1 MB chunks, which counts how much of it was read. */
const streamed = (total: number) => {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= total) {
          controller.close();
          return;
        }
        const size = Math.min(MB, total - pulled);
        pulled += size;
        controller.enqueue(new Uint8Array(size));
      },
    },
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => pulled };
};

/** Uploads a raw stream as the body, as a client sending chunked or with any length it declares. */
const uploadStream = (
  user: TestUser,
  stream: ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
) =>
  startImport(
    new Request(`http://localhost:3000/api/v1/spaces/${user.spaceId}/imports`, {
      method: "POST",
      headers: { cookie: user.cookie, "content-type": "multipart/form-data; boundary=x", ...headers },
      body: stream,
      duplex: "half",
    } as RequestInit),
    routeParams({ spaceId: user.spaceId }),
  );

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
    groups: {
      name: string;
      icon: string | null;
      target: string;
      categories: { sourceId: string; name: string; icon: string | null; target: string }[];
    }[];
    archiveUnusedCategories: boolean;
    unusedSeeded: { groups: { id: string; name: string }[]; categories: { id: string; name: string }[] };
  };
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

/** The space's seeded groups (D11), as the categories module seeds them at sign-up. */
const seededGroups = async (spaceId: string) =>
  (
    await app.pool.query(
      "SELECT id, name, archived_at FROM category_groups WHERE space_id = $1 AND key IS NOT NULL ORDER BY position",
      [spaceId],
    )
  ).rows as { id: string; name: string; archived_at: Date | null }[];

/**
 * #350: what "Archivar las de Hearth que no uses" takes from a fresh space whose import brings an income category:
 * every seeded group but Ingresos, which the income lands in, whole, and Ingresos' own seeded categories.
 */
const seededArchivedBesideIncome = async (spaceId: string) =>
  (await seededGroups(spaceId)).length -
  1 +
  Number(
    (
      await app.pool.query(
        "SELECT count(*) FROM categories c JOIN category_groups g ON g.id = c.group_id " +
          "WHERE g.space_id = $1 AND g.key = 'income' AND c.key IS NOT NULL AND c.parent_category_id IS NULL",
        [spaceId],
      )
    ).rows[0].count,
  );

interface TreeGroup {
  id: string;
  name: string;
  key: string | null;
  archivedAt: string | null;
  categories: { id: string; name: string; archivedAt: string | null }[];
}

/** The space's category tree through the categories API, archived groups and categories included. */
const treeOf = async (user: TestUser): Promise<TreeGroup[]> => {
  const response = await call(
    listCategories,
    "GET",
    `/api/v1/spaces/${user.spaceId}/categories?archived=true`,
    {
      user,
      params: { spaceId: user.spaceId },
    },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: TreeGroup[] }).items;
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

// Design Q4 (#329): adj1, the bank's adjustment after its first movement, is a movement of its own.
const EVERY_ROW = ["m1", "m2", "t1", "m5", "m6", "m7", "adj1"];

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
      // P337: Visa has no movement and a zero balance, so Hearth suggests archiving it (created, then archived).
      "a-card": { kind: "archive", accountId: null, type: "CREDIT_CARD", currency: "COP", name: "Visa" },
    });
    // P337: each Money Manager expense category is a group, in its order; Food is used directly too, so it keeps a
    // category of its own name before its subcategory. #350: the income one is a category of the seeded Ingresos.
    expect(preview.categories.groups).toEqual([
      {
        name: "Food",
        icon: "🍔",
        target: "new",
        categories: [
          { sourceId: "c-food", name: "Food", icon: "🍔", target: "new" },
          { sourceId: "c-food-sub", name: "Supermercado", icon: "🍔", target: "new" },
        ],
      },
      {
        name: "Guitarra",
        icon: "🎸",
        target: "new",
        categories: [{ sourceId: "c-guitar", name: "Guitarra", icon: "🎸", target: "new" }],
      },
      {
        name: "Ingresos",
        icon: null,
        target: "existing",
        categories: [{ sourceId: "c-salary", name: "Salary", icon: "💰", target: "new" }],
      },
    ]);
    // No movement uses any seeded group yet: the switch, on by default, would archive them all but Ingresos, which
    // Salary lands in (#350), and Ingresos' own seeded categories.
    expect(preview.categories.archiveUnusedCategories).toBe(true);
    expect(preview.categories.unusedSeeded.groups.map((g) => g.name).sort()).toEqual(
      (await seededGroups(ana.spaceId))
        .map((g) => g.name)
        .filter((name) => name !== "Ingresos")
        .sort(),
    );
    expect(preview.categories.unusedSeeded.categories).toHaveLength(
      (await seededArchivedBesideIncome(ana.spaceId)) - ((await seededGroups(ana.spaceId)).length - 1),
    );
    expect(preview.plan).toEqual({
      movements: 7,
      alreadyImported: [],
      duplicatesSkipped: 0,
      adjustmentsInOpeningBalance: 1,
      adjustmentsNotImported: 0,
    });
    expect(await liveMovements(ana.spaceId)).toBe(0);
  });

  it("refuses a file over 20 MB with 422 ImportFileTooLarge", async () => {
    const ana = await registerUser("Ana");
    const big = new Uint8Array(20 * 1024 * 1024 + 1);
    big.set(backup);
    const refused = await upload(ana, big);
    expect(refused.status).toBe(422);
    expect(await refused.json()).toMatchObject({ code: "ImportFileTooLarge", maxBytes: 20 * 1024 * 1024 });
  });

  it("refuses a body whose declared length is over the limit without reading any of it", async () => {
    const ana = await registerUser("Ana");
    const body = streamed(30 * MB);
    const response = await uploadStream(ana, body.stream, { "content-length": String(30 * MB) });
    expect(await problemOf(response)).toEqual([422, "ImportFileTooLarge"]);
    expect(body.pulled()).toBe(0);
  });

  it("stops reading a body sent without a length once it passes the limit", async () => {
    const ana = await registerUser("Ana");
    const body = streamed(30 * MB);
    const response = await uploadStream(ana, body.stream);
    expect(await problemOf(response)).toEqual([422, "ImportFileTooLarge"]);
    // At most the limit, its framing allowance and one more chunk were read: never the whole 30 MB.
    expect(body.pulled()).toBeLessThanOrEqual(21 * MB + 64 * 1024);
  });

  it("refuses a third upload at once while two are still being read, without reading its body", async () => {
    const ana = await registerUser("Ana");
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    const held = () =>
      new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            await released;
            controller.close();
          },
        },
        { highWaterMark: 0 },
      );
    const first = uploadStream(ana, held());
    const second = uploadStream(ana, held());
    await new Promise((resolve) => setTimeout(resolve, 50));
    const third = streamed(1 * MB);
    const refused = await uploadStream(ana, third.stream);
    expect(await problemOf(refused)).toEqual([429, "TooManyRequests"]);
    expect(third.pulled()).toBe(0);
    release();
    await Promise.all([first, second]);
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

  it("gives up on a body that stops arriving, answering 422 ImportTimedOut, and frees its slot", async () => {
    const ana = await registerUser("Ana");
    const hasty = startTestApp({ uploadReadTimeoutMs: 50 });
    const stalled = () =>
      new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }, { highWaterMark: 0 });
    try {
      const [first, second] = await Promise.all([uploadStream(ana, stalled()), uploadStream(ana, stalled())]);
      expect(await problemOf(first)).toEqual([422, "ImportTimedOut"]);
      expect(await problemOf(second)).toEqual([422, "ImportTimedOut"]);
      expect((await upload(ana, backup)).status).toBe(201);
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
    // Refused before the body is read: a VIEWER or a stranger never makes the server buffer an upload.
    const body = streamed(5 * MB);
    const refused = await uploadStream({ ...sofi, spaceId: household }, body.stream);
    expect(await problemOf(refused)).toEqual([403, "InsufficientRole"]);
    expect(body.pulled()).toBe(0);
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
        // P337: Food, Supermercado and Guitarra in two groups of their own; #350: Salary in Ingresos.
        categoriesCreated: 4,
        categoriesRestored: 0,
        // P342 (S3): the USD expense from the USD account needs no rate any more, so every movement comes in.
        movementsImported: 7,
        alreadyImported: 0,
        duplicatesSkipped: 0,
        adjustmentsInOpeningBalance: 1,
        adjustmentsNotImported: 0,
        rowErrors: 0,
        peopleCreated: 0,
        accountsArchived: 1,
        hearthCategoriesArchived: await seededArchivedBesideIncome(ana.spaceId),
      },
      rowErrors: [],
    });

    const bank = await accountNamed(ana.spaceId, "Banco Uno");
    // Gap G1: the adjustment before the account's first movement is its opening balance, 50,000.00 COP.
    expect(bank).toMatchObject({ type: "BANK", currency: "COP", opening_balance: "5000000" });
    expect(await accountNamed(ana.spaceId, "US savings")).toMatchObject({ currency: "USD" });
    expect(await accountNamed(ana.spaceId, "Visa")).toMatchObject({
      type: "CREDIT_CARD",
      cut_off_day: 15,
      payment_day: 5,
      // P337: Archivar keeps the account and its history, out of the pickers and totals.
      archived_at: expect.any(Date),
    });

    const { rows } = await app.pool.query(
      `SELECT t.type, t.description, t.date::text, t.occurred_at, t.time_zone, t.amount, t.currency, t.original_amount,
              t.original_currency, t.source_amount, t.destination_amount, t.destination_currency,
              (SELECT p.account_amount FROM payments p WHERE p.transaction_id = t.id) AS account_amount
         FROM transactions t WHERE t.space_id = $1 AND t.deleted_at IS NULL ORDER BY t.date, t.type`,
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
      // P342 (S3): 20.00 USD charged as 80,000.00 COP on the COP bank: the expense is in USD, with no base and no
      // original, and the bank's payment keeps what it moved, in the bank's COP.
      expect.objectContaining({
        type: "EXPENSE",
        date: "2025-02-05",
        amount: "2000",
        currency: "USD",
        original_amount: null,
        account_amount: "8000000",
      }),
      // P342 (S3): 15.00 USD from the USD account, in USD, with no leg and no rate needed.
      expect.objectContaining({
        type: "EXPENSE",
        date: "2025-02-06",
        amount: "1500",
        currency: "USD",
        original_amount: null,
        account_amount: null,
      }),
      // Design Q4 (#329): the bank's later adjustment, -1,000.00 COP, is a balance adjustment out of it.
      expect.objectContaining({
        type: "ADJUSTMENT",
        date: "2025-03-01",
        amount: "100000",
      }),
    ]);
  });

  it("imports nothing twice when the same file is uploaded and confirmed again, and says it was imported before", async () => {
    const ana = await registerUser("Ana");
    await imported(ana);
    const before = await liveMovements(ana.spaceId);

    const again = await uploaded(ana);
    expect(again.previouslyImportedAt).toBe("2026-11-16T15:00:00.000Z");
    expect(again.plan.alreadyImported.sort()).toEqual(["adj0", "adj1", "m1", "m2", "m5", "m6", "m7", "t1"]);
    // P337: the archived Visa stays the one its movements would go to, never a new one beside it.
    const visa = await accountNamed(ana.spaceId, "Visa");
    expect(Object.fromEntries(again.accounts.map((a) => [a.sourceId, a.mapping.kind]))).toEqual({
      "a-cash": "existing",
      "a-bank": "existing",
      "a-usd": "existing",
      "a-card": "archive",
    });
    expect(again.accounts.find((a) => a.sourceId === "a-card")?.mapping.accountId).toBe(visa?.id);
    const result = await confirmed(ana, again.id);

    expect(result.counts).toMatchObject({
      accountsCreated: 0,
      categoriesCreated: 0,
      movementsImported: 0,
      alreadyImported: 8,
      rowErrors: 0,
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
    expect(result.counts).toMatchObject({ movementsImported: 7, duplicatesSkipped: 0 });
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

  it("replays the first answer to a confirm sent again with the same idempotency key, importing nothing twice", async () => {
    const ana = await registerUser("Ana");
    const preview = await uploaded(ana);
    const key = crypto.randomUUID();
    const first = await confirm(ana, preview.id, key);
    const before = await liveMovements(ana.spaceId);

    const again = await confirm(ana, preview.id, key);

    expect([first.status, again.status]).toEqual([200, 200]);
    expect(await again.json()).toEqual(await first.json());
    expect(await liveMovements(ana.spaceId)).toBe(before);
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
    // An existing account keeps its own opening balance: both adjustments are ADJUSTMENT movements (design Q4).
    expect(view.plan).toMatchObject({
      movements: 8,
      adjustmentsInOpeningBalance: 0,
      adjustmentsNotImported: 0,
    });

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
      movementsDeleted: 7,
      // Visa was archived by the confirm already (P337): only the bank and the USD account are archived now.
      accountsArchived: 2,
      categoriesArchived: 4,
      // P337: the two groups it created are empty again, and the seeded groups and categories it archived come back.
      categoryGroupsArchived: 2,
      hearthCategoriesRestored: await seededArchivedBesideIncome(ana.spaceId),
    });
    expect(await liveMovements(ana.spaceId)).toBe(0);
    expect((await seededGroups(ana.spaceId)).every((g) => g.archived_at === null)).toBe(true);
    const tree = await treeOf(ana);
    expect(tree.filter((g) => ["Food", "Guitarra"].includes(g.name)).map((g) => g.archivedAt)).toEqual([
      expect.any(String),
      expect.any(String),
    ]);
    const { rows } = await app.pool.query(
      "SELECT count(*) FROM transactions WHERE space_id = $1 AND deleted_at IS NOT NULL",
      [ana.spaceId],
    );
    expect(Number(rows[0].count)).toBe(7);
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

    expect(await response.json()).toMatchObject({ status: "UNDONE", movementsDeleted: 6 });
    expect(await liveMovements(ana.spaceId)).toBe(0);
  });

  it("imports a later balance adjustment as an ADJUSTMENT of its account, linked, and its undo deletes it (design Q4)", async () => {
    const ana = await registerUser("Ana");
    const { preview } = await imported(ana);
    const bank = (await accountNamed(ana.spaceId, "Banco Uno"))!;
    const adjustment = async () =>
      (
        await app.pool.query(
          `SELECT t.id, t.source_account_id, t.destination_account_id, t.amount, t.deleted_at
             FROM transactions t WHERE t.space_id = $1 AND t.type = 'ADJUSTMENT'`,
          [ana.spaceId],
        )
      ).rows;
    const [row] = await adjustment();
    expect(row).toMatchObject({
      source_account_id: bank.id,
      destination_account_id: null,
      amount: "100000",
      deleted_at: null,
    });
    const links = await app.pool.query(
      "SELECT entity_type FROM import_links WHERE space_id = $1 AND source_key = 'adj1' AND entity_id = $2",
      [ana.spaceId, row.id],
    );
    expect(links.rows).toEqual([{ entity_type: "MOVEMENT" }]);

    const undone = await call(undoImport, "POST", importPath(ana, preview.id, "/undo"), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
    });
    expect(undone.status).toBe(200);
    expect((await adjustment())[0].deleted_at).not.toBeNull();
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
      // Visa (Archivar, P337) has no movement to take: it stays archived, never restored.
      accountsRestored: 2,
      categoriesCreated: 0,
      // P337: the groups the undo archived come back with their categories, never made again.
      categoriesRestored: 4,
      movementsImported: 7,
      // The restored bank still holds adj0 in its opening balance: kept there, never recorded on top of it.
      adjustmentsInOpeningBalance: 1,
    });
    expect(await accountNamed(ana.spaceId, "Banco Uno")).toMatchObject({
      id: bank?.id,
      archived_at: null,
      opening_balance: "5000000",
    });
    expect(await liveMovements(ana.spaceId)).toBe(7);
  });

  it("gives a new account a name no archived one holds, and says so in the preview", async () => {
    const ana = await registerUser("Ana");
    const archived = await newAccount(ana, "banco uno", 0, "SAVINGS");
    await app.accounts.archiveAccount({ spaceId: ana.spaceId, userId: ana.userId, accountId: archived });

    const preview = await uploaded(ana);
    expect(preview.accounts.find((a) => a.sourceId === "a-bank")?.mapping).toEqual({
      kind: "new",
      type: "BANK",
      currency: "COP",
      name: "Banco Uno (Money Manager)",
    });
    const result = await confirmed(ana, preview.id);

    expect(result.counts).toMatchObject({ accountsCreated: 3, categoriesCreated: 4, movementsImported: 7 });
    expect(await accountNamed(ana.spaceId, "Banco Uno (Money Manager)")).toMatchObject({ archived_at: null });
  });
});

describe("your categories as you had them (P337, #333)", () => {
  const adjust = (user: TestUser, importId: string, body: unknown) =>
    call(adjustImport, "PATCH", importPath(user, importId), {
      user,
      params: { spaceId: user.spaceId, importId },
      body,
    });

  it("makes each category a group of its subcategories, in Money Manager's order, and archives the seeded ones nothing uses", async () => {
    const ana = await registerUser("Ana");
    const { preview } = await imported(ana);

    const tree = await treeOf(ana);
    const live = tree.filter((g) => g.archivedAt === null);
    const liveNames = (g: TreeGroup) => g.categories.filter((c) => c.archivedAt === null).map((c) => c.name);
    // #350: Salary, an income category, lands in the seeded Ingresos, the only group an income is offered (#173).
    expect(live.map((g) => [g.name, liveNames(g)])).toEqual([
      ["Ingresos", ["Salary"]],
      ["Food", ["Food", "Supermercado"]],
      ["Guitarra", ["Guitarra"]],
    ]);
    // Every other seeded group is archived, its categories with it, and can be restored.
    const seeded = tree.filter((g) => g.key !== null && g.key !== "income");
    expect(seeded.length).toBeGreaterThan(0);
    expect(seeded.every((g) => g.archivedAt !== null)).toBe(true);
    const vivienda = seeded.find((g) => g.name === "Vivienda")!;
    expect((await app.categories.restoreCategoryGroup({ ...ana, groupId: vivienda.id })).ok).toBe(true);
    const restored = (await treeOf(ana)).find((g) => g.id === vivienda.id)!;
    expect(restored.archivedAt).toBeNull();
    expect(restored.categories.every((c) => c.archivedAt === null)).toBe(true);

    const links = await app.pool.query(
      "SELECT source_key FROM import_links WHERE import_id = $1 AND entity_type = 'CATEGORY_GROUP' ORDER BY source_key",
      [preview.id],
    );
    expect(links.rows.map((r: { source_key: string }) => r.source_key)).toEqual([
      "c-food",
      "c-guitar",
      "c-salary",
    ]);
  });

  it("lands an income category in Ingresos with its subcategories, and its movements on them (#350)", async () => {
    const ana = await registerUser("Ana");
    const bonus: BackupMovement = {
      uid: "b1",
      doType: 0,
      wdate: "2025-01-31",
      zdate: Date.UTC(2025, 0, 31, 15),
      asset: "a-bank",
      category: "c-bonus",
      currency: 1,
      entered: "500000.0",
      inAccount: 500000,
    };
    const response = await upload(
      ana,
      moneyManagerBackup([bonus], [], [{ uid: "c-bonus", name: "Bono", type: 0, parent: "c-salary" }]),
    );
    expect(response.status).toBe(201);
    const preview = (await response.json()) as Preview;
    await confirmed(ana, preview.id);

    const tree = (await treeOf(ana)) as unknown as {
      name: string;
      key: string | null;
      archivedAt: string | null;
      categories: { name: string; subcategories: { id: string; name: string }[] }[];
    }[];
    const ingresos = tree.find((g) => g.key === "income")!;
    expect(ingresos.archivedAt).toBeNull();
    const salary = ingresos.categories.find((c) => c.name === "Salary")!;
    expect(salary.subcategories.map((s) => s.name)).toEqual(["Bono"]);
    // No group stands for an income category any more, so Gasto never offers it.
    expect(tree.some((g) => g.name === "Salary")).toBe(false);
    const { rows } = await app.pool.query(
      "SELECT category_id FROM transactions WHERE space_id = $1 AND type = 'INCOME' AND deleted_at IS NULL",
      [ana.spaceId],
    );
    expect(rows).toEqual([{ category_id: salary.subcategories[0]!.id }]);

    // An undo archives the subcategory and the category it created, and keeps the seeded Ingresos.
    const undone = await call(undoImport, "POST", importPath(ana, preview.id, "/undo"), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
    });
    expect(undone.status).toBe(200);
    const after = (await treeOf(ana)) as unknown as {
      key: string | null;
      archivedAt: string | null;
      categories: {
        name: string;
        archivedAt: string | null;
        subcategories: { archivedAt: string | null }[];
      }[];
    }[];
    const ingresosAfter = after.find((g) => g.key === "income")!;
    expect(ingresosAfter.archivedAt).toBeNull();
    const salaryAfter = ingresosAfter.categories.find((c) => c.name === "Salary")!;
    expect(salaryAfter.archivedAt).not.toBeNull();
    expect(salaryAfter.subcategories.map((sub) => sub.archivedAt)).toEqual([expect.any(String)]);
    expect(await liveMovements(ana.spaceId)).toBe(0);
  });

  it("archives nothing of Hearth's when the person turns the switch off", async () => {
    const ana = await registerUser("Ana");
    const preview = await uploaded(ana);
    const off = await adjust(ana, preview.id, { archiveUnusedCategories: false });
    expect(off.status).toBe(200);
    expect(((await off.json()) as Preview).categories.archiveUnusedCategories).toBe(false);

    const result = await confirmed(ana, preview.id);

    expect(result.counts).toMatchObject({ hearthCategoriesArchived: 0, categoriesCreated: 4 });
    expect((await seededGroups(ana.spaceId)).every((g) => g.archived_at === null)).toBe(true);
  });

  it("keeps a seeded category a budget line or a recurrence names, with its group, though no movement uses it", async () => {
    const ana = await registerUser("Ana");
    // Rent repeats every month, and a plan's line consumes Travel: neither has a movement yet.
    const rent = await categoryWithKey(ana, "rent");
    const travel = await categoryWithKey(ana, "travel");
    const member = await app.pool.query("SELECT id FROM space_members WHERE space_id = $1", [ana.spaceId]);
    await defined(ana, ana.spaceId, {
      description: "Arriendo",
      amount: cop(1_200_000),
      template: {
        type: "EXPENSE",
        categoryId: rent,
        payer: {
          memberId: (member.rows[0] as { id: string }).id,
          accountId: await starterAccount(ana, "Cuenta bancaria"),
        },
      },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: "2027-01-01",
    });
    const { id: planId } = await newPlan(ana, ana.spaceId, "2027-01");
    await setCapacities(ana, ana.spaceId, planId, [[(member.rows[0] as { id: string }).id, 2_000_000]]);
    const plan = await addLine(ana, ana.spaceId, planId, {
      name: "Viajes",
      pesos: 500_000,
      funding: "DIRECT",
      rolloverMode: "RESET",
    });
    const mapped = await putCategories(ana, ana.spaceId, planId, lineNamed(plan, "Viajes").id, [travel]);
    expect(mapped.status).toBe(200);

    const preview = await uploaded(ana);
    expect(preview.categories.unusedSeeded.categories.map((c) => c.id)).not.toContain(rent);
    await confirmed(ana, preview.id);

    const tree = await treeOf(ana);
    const holding = (categoryId: string) => tree.find((g) => g.categories.some((c) => c.id === categoryId))!;
    for (const id of [rent, travel]) {
      expect(holding(id).archivedAt).toBeNull();
      expect(holding(id).categories.find((c) => c.id === id)!.archivedAt).toBeNull();
    }
    // The rest of those groups' seeded categories, which nothing names, are still archived.
    expect(
      holding(rent)
        .categories.filter((c) => c.id !== rent)
        .every((c) => c.archivedAt !== null),
    ).toBe(true);
  });

  it("puts a category in a group of its name ignoring case, restoring an archived one, and keeps a used seeded group", async () => {
    const ana = await registerUser("Ana");
    const food = await app.categories.createCategoryGroup({ ...ana, name: "food" });
    if (!food.ok) throw new Error(food.error.code);
    expect((await app.categories.archiveCategoryGroup({ ...ana, groupId: food.value.id })).ok).toBe(true);
    // Ana pays for groceries in Hearth already: the seeded group holding it stays, and so does Mercado.
    const typed = await post(recordExpense, ana, "expenses", {
      description: "Mercado",
      date: "2026-11-01",
      categoryId: await categoryWithKey(ana, "groceries"),
      amount: cop(10_000),
      accountId: await starterAccount(ana, "Efectivo"),
    });
    expect(typed.status).toBe(201);

    const preview = await uploaded(ana);
    expect(preview.categories.groups[0]).toMatchObject({ name: "Food", target: "existing" });
    const result = await confirmed(ana, preview.id);

    expect(result.counts).toMatchObject({ categoriesCreated: 4 });
    const tree = await treeOf(ana);
    expect(tree.find((g) => g.id === food.value.id)).toMatchObject({ name: "food", archivedAt: null });
    expect(tree.find((g) => g.id === food.value.id)?.categories.map((c) => c.name)).toEqual([
      "Food",
      "Supermercado",
    ]);
    const groceries = tree.find((g) =>
      g.categories.some((c) => c.name === "Mercado" && c.archivedAt === null),
    );
    expect(groceries?.archivedAt).toBeNull();
  });
});

describe("what each account is: Cuenta, Persona or Archivar (P337, #332)", () => {
  const leg = { zdate: 0, currency: 1 as const };
  /** Ana lent Mom 500,000 from the bank, Mom paid 150,000 back, and "Cash" is Money Manager's cash beside Efectivo. */
  const lending: BackupMovement[] = [
    {
      ...leg,
      uid: "l1",
      doType: 3,
      wdate: "2025-01-05",
      asset: "a-bank",
      toAsset: "a-mom",
      entered: "500000.0",
      inAccount: 500000,
      txUidTrans: "lend",
    },
    {
      ...leg,
      uid: "l2",
      doType: 4,
      wdate: "2025-01-05",
      asset: "a-mom",
      toAsset: "a-bank",
      entered: "500000.0",
      inAccount: 500000,
      txUidTrans: "lend",
    },
    {
      ...leg,
      uid: "l3",
      doType: 3,
      wdate: "2025-02-05",
      asset: "a-mom",
      toAsset: "a-bank",
      entered: "150000.0",
      inAccount: 150000,
      txUidTrans: "back",
    },
    {
      ...leg,
      uid: "l4",
      doType: 4,
      wdate: "2025-02-05",
      asset: "a-bank",
      toAsset: "a-mom",
      entered: "150000.0",
      inAccount: 150000,
      txUidTrans: "back",
    },
    {
      ...leg,
      uid: "c1",
      doType: 1,
      wdate: "2025-02-06",
      asset: "a-mm-cash",
      category: "c-food",
      entered: "8000.0",
      inAccount: 8000,
    },
  ];
  const sorted = moneyManagerBackup(lending, [
    { uid: "a-mom", name: "Mom Loan", group: "g-loan", currency: 1 },
    { uid: "a-mm-cash", name: "Cash", group: "g-cash", currency: 1, order: 1 },
  ]);

  it("suggests what each account is, and offers the three ready mappings with what the board shows", async () => {
    const ana = await registerUser("Ana");
    const response = await upload(ana, sorted);
    expect(response.status).toBe(201);
    const preview = (await response.json()) as {
      accounts: {
        sourceId: string;
        suggested: string;
        duplicateOf: unknown;
        movementCount: number;
        options: unknown;
      }[];
    };
    const efectivo = await starterAccount(ana, "Efectivo");
    const bySource = Object.fromEntries(preview.accounts.map((a) => [a.sourceId, a]));
    expect(bySource["a-mom"]).toMatchObject({ suggested: "PERSON", movementCount: 2, duplicateOf: null });
    expect(bySource["a-mom"]?.options).toMatchObject({ person: { kind: "person", name: "Mom" } });
    expect(bySource["a-mm-cash"]).toMatchObject({
      suggested: "ARCHIVE",
      duplicateOf: { id: efectivo, name: "Efectivo" },
      options: { archive: { kind: "archive", accountId: efectivo } },
    });
    expect(bySource["a-bank"]).toMatchObject({ suggested: "ACCOUNT" });
    // In Money Manager's own order: its groups' order (Cash, Accounts, Card, Loan), then each account's.
    expect(preview.accounts.map((a) => a.sourceId)).toEqual([
      "a-cash",
      "a-mm-cash",
      "a-bank",
      "a-usd",
      "a-card",
      "a-mom",
    ]);
  });

  it("records Mom as a guest in Ana's direct space, owing what is left, with no account, and Cash in Efectivo", async () => {
    const ana = await registerUser("Ana");
    const efectivo = await starterAccount(ana, "Efectivo");
    const response = await upload(ana, sorted);
    const preview = (await response.json()) as Preview;

    const result = await confirmed(ana, preview.id);

    expect(result.counts).toMatchObject({ peopleCreated: 1, rowErrors: 0 });
    expect(await accountNamed(ana.spaceId, "Mom Loan")).toBeUndefined();
    expect(await accountNamed(ana.spaceId, "Mom")).toBeUndefined();
    expect(await accountNamed(ana.spaceId, "Cash")).toBeUndefined();
    const cashExpense = await app.pool.query(
      "SELECT count(*) FROM transactions t JOIN payments p ON p.transaction_id = t.id WHERE t.space_id = $1 AND p.account_id = $2",
      [ana.spaceId, efectivo],
    );
    expect(Number(cashExpense.rows[0].count)).toBe(1);

    const direct = await app.pool.query(
      `SELECT s.id, s.name FROM spaces s JOIN import_links l ON l.entity_id = s.id
        WHERE l.space_id = $1 AND l.entity_type = 'PERSON' AND l.source_key = 'a-mom'`,
      [ana.spaceId],
    );
    expect(direct.rows).toEqual([{ id: expect.any(String), name: "Ana & Mom" }]);
    const directId = direct.rows[0].id as string;
    const balances = await call(directBalance, "GET", `/api/v1/spaces/${directId}/balances`, {
      user: ana,
      params: { spaceId: directId },
    });
    expect(balances.status).toBe(200);
    const names = new Map(
      (
        await app.pool.query("SELECT id, display_name FROM space_members WHERE space_id = $1", [directId])
      ).rows.map((m: { id: string; display_name: string }) => [m.id, m.display_name]),
    );
    const nets = (
      (await balances.json()) as { members: { memberId: string; net: { amount: string } }[] }
    ).members.map((m) => [names.get(m.memberId), m.net.amount]);
    // Mom got 500,000 and paid 150,000 back: she owes Ana 350,000.00.
    expect(Object.fromEntries(nets)).toEqual({ Ana: "35000000", Mom: "-35000000" });

    const undone = await call(undoImport, "POST", importPath(ana, preview.id, "/undo"), {
      user: ana,
      params: { spaceId: ana.spaceId, importId: preview.id },
    });
    expect(await undone.json()).toMatchObject({ status: "UNDONE", movementsDeleted: 3 });
    const live = await liveMovements(directId);
    expect(live).toBe(0);
    // No hard delete: the direct space and its guest stay.
    expect(
      (await app.pool.query("SELECT count(*) FROM spaces WHERE id = $1", [directId])).rows[0].count,
    ).toBe("1");
  });

  it("takes Cuenta or Persona the person chooses instead, and refuses a Persona in another currency", async () => {
    const ana = await registerUser("Ana");
    const preview = (await (await upload(ana, sorted)).json()) as Preview;
    const adjust = (body: unknown) =>
      call(adjustImport, "PATCH", importPath(ana, preview.id), {
        user: ana,
        params: { spaceId: ana.spaceId, importId: preview.id },
        body,
      });

    const asAccount = await adjust({ accounts: { "a-mom": { kind: "new", type: "LOAN", currency: "COP" } } });
    expect(asAccount.status).toBe(200);
    expect(((await asAccount.json()) as Preview).accounts.find((a) => a.sourceId === "a-mom")).toMatchObject({
      suggested: "PERSON",
      mapping: { kind: "new", name: "Mom Loan" },
    });

    const named = await adjust({ accounts: { "a-mom": { kind: "person", name: "  Mamá " } } });
    expect(((await named.json()) as Preview).accounts.find((a) => a.sourceId === "a-mom")?.mapping).toEqual({
      kind: "person",
      name: "Mamá",
    });
    const refused = await adjust({ accounts: { "a-usd": { kind: "person" } } });
    expect(await refused.json()).toMatchObject({
      code: "InvalidImportMapping",
      reason: "currencyMismatch",
      sourceId: "a-usd",
    });
  });
});

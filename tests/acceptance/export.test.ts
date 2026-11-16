import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as exportMyData } from "@/app/api/v1/me/export/route";
import { POST as recordAdjustment } from "@/app/api/v1/spaces/[spaceId]/adjustments/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  categoryWithKey,
  cop,
  household,
  newAccount,
  post,
  settles,
  type Household,
} from "../support/ledger";
import { defined, homePlan, householdWithFund, rentBody } from "../support/recurrences";
import { readZip } from "../support/zip";

/** Exports each person may run per minute in this suite; the throttle test runs one more. */
const LIMIT = 3;

let app: Container;
beforeAll(() => {
  // 03:00 UTC on 1 November is still 31 October in Bogotá: the file is dated in the person's zone, never in UTC.
  app = startTestApp({ clock: new FixedClock(new Date("2026-11-01T03:00:00Z")), exportsPerMinute: LIMIT });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const exportAs = (user: TestUser | undefined, query: string) =>
  call(exportMyData, "GET", `/api/v1/me/export?${query}`, { user });

interface ExportJson {
  format: string;
  version: number;
  exportedAt: string;
  person: { name: string; locale: string; timeZone: string };
  spaces: {
    id: string;
    name: string;
    kind: string;
    currency: string;
    members: { name: string; role: string | null; you: boolean }[];
    accounts: { id: string; name: string; openingBalance: { amount: string; currency: string } }[];
    categoryGroups: { categories: { key: string | null }[] }[];
    movements: {
      description: string;
      date: string;
      amount: { amount: string; currency: string };
      payments: { member: { name: string | null } | null; account: { id: string; name: string } | null }[];
      shares: { member: { name: string | null }; amount: { amount: string; currency: string } }[];
    }[];
    recurrences: unknown[];
    plans: unknown[];
  }[];
}

/** Juan pays 16,000 pesos of groceries in the household from his personal account, split with Ana. */
const juanPaysGroceries = async (h: Household, description = "Mercado") => {
  const response = await post(recordExpense, h.juan, "expenses", {
    description,
    date: "2026-10-05",
    categoryId: h.groceries,
    amount: cop(16_000),
    payments: [{ memberId: h.juan.memberId, accountId: h.juan.account, amount: cop(16_000) }],
    split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
  });
  expect(response.status).toBe(201);
};

/** Ana pays `pesos` in the household from her own account, split with Juan. */
const anaPays = async (h: Household, description: string, pesos: number) => {
  const response = await post(recordExpense, h.ana, "expenses", {
    description,
    date: "2026-10-06",
    categoryId: h.groceries,
    amount: cop(pesos),
    payments: [{ memberId: h.ana.memberId, accountId: h.ana.account, amount: cop(pesos) }],
    split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
  });
  expect(response.status).toBe(201);
};

describe("GET /api/v1/me/export (D28, design §3.6)", () => {
  it("answers 401 without a session", async () => {
    expect(await problemOf(await exportAs(undefined, "format=json"))).toEqual([401, "Unauthenticated"]);
  });

  it("gives Hearth's JSON export, version 1, of the personal space and every shared space, dated in Ana's zone", async () => {
    const h = await household();
    await juanPaysGroceries(h);

    const response = await exportAs(h.ana.personal, "format=json");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="hearth-export-2026-10-31.json"',
    );
    const body = (await response.json()) as ExportJson;
    expect(body).toMatchObject({
      format: "hearth-export",
      version: 1,
      exportedAt: "2026-11-01T03:00:00.000Z",
      person: { name: "Ana", timeZone: "America/Bogota" },
    });
    expect(body.spaces.map((s) => [s.id, s.kind])).toEqual(
      expect.arrayContaining([
        [h.ana.personal.spaceId, "PERSONAL"],
        [h.spaceId, "SHARED"],
      ]),
    );
    const personal = body.spaces.find((s) => s.id === h.ana.personal.spaceId)!;
    expect(personal.accounts.find((a) => a.id === h.ana.account)).toMatchObject({
      name: "Bancolombia",
      openingBalance: cop(2_000_000),
    });
    const shared = body.spaces.find((s) => s.id === h.spaceId)!;
    expect(shared.members.map((m) => [m.name, m.role, m.you])).toEqual([
      ["Ana", "OWNER", true],
      ["Juan", "MEMBER", false],
    ]);
    expect(shared.categoryGroups.flatMap((g) => g.categories.map((c) => c.key))).toContain("groceries");
    expect(shared.recurrences).toEqual([]);
    expect(shared.plans).toEqual([]);
  });

  it("shows Juan's payment from his personal account only by his name, never its id or name (D9)", async () => {
    const h = await household();
    await juanPaysGroceries(h);
    await anaPays(h, "Pan", 4_000);

    const response = await exportAs(h.ana.personal, "format=json");
    const text = await response.text();
    const shared = (JSON.parse(text) as ExportJson).spaces.find((s) => s.id === h.spaceId)!;

    const groceries = shared.movements.find((m) => m.description === "Mercado")!;
    expect(groceries.amount).toEqual(cop(16_000));
    expect(groceries.payments).toEqual([
      { member: { memberId: h.juan.memberId, name: "Juan" }, account: null, amount: cop(16_000) },
    ]);
    expect(groceries.shares.map((s) => [s.member.name, s.amount])).toEqual([
      ["Ana", cop(8_000)],
      ["Juan", cop(8_000)],
    ]);
    // Ana's own payment names her account.
    const bread = shared.movements.find((m) => m.description === "Pan")!;
    expect(bread.payments[0]!.account).toEqual({ id: h.ana.account, name: "Bancolombia" });
    expect(text).not.toContain(h.juan.account);
    expect(text).not.toContain("Davivienda");
    expect(text).not.toContain(h.juan.personal.spaceId);
  });

  it("still names a member who left the space on the payments and shares they made (D15)", async () => {
    const h = await household();
    await juanPaysGroceries(h);
    await settles(h.ana, h.ana.memberId, h.juan.memberId, 8_000);
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: h.juan,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);

    const response = await exportAs(h.ana.personal, `format=json&spaceId=${h.spaceId}`);
    const text = await response.text();
    const [shared] = (JSON.parse(text) as ExportJson).spaces;

    expect(shared!.members.map((m) => m.name)).toEqual(["Ana"]);
    const groceries = shared!.movements.find((m) => m.description === "Mercado")!;
    expect(groceries.payments.map((p) => [p.member?.name, p.account])).toEqual([["Juan", null]]);
    expect(groceries.shares.map((s) => s.member.name)).toEqual(["Ana", "Juan"]);
    expect(text).not.toContain(h.juan.account);
  });

  it("exports only the space named by spaceId", async () => {
    const h = await household();

    const response = await exportAs(h.ana.personal, `format=json&spaceId=${h.spaceId}`);

    expect(response.status).toBe(200);
    expect(((await response.json()) as ExportJson).spaces.map((s) => s.id)).toEqual([h.spaceId]);
  });

  it("answers 404 SpaceNotFound for a space Ana is not in, and for an id that names nothing", async () => {
    const h = await household();

    expect(
      await problemOf(await exportAs(h.ana.personal, `format=json&spaceId=${h.juan.personal.spaceId}`)),
    ).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await exportAs(h.ana.personal, "format=csv&spaceId=not-a-space"))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("answers 422 for an unknown format", async () => {
    const h = await household();
    expect(await problemOf(await exportAs(h.ana.personal, "format=xml"))).toEqual([422, "ValidationFailed"]);
  });

  it("gives a ZIP of movements.csv, accounts.csv and categories.csv, with a BOM, guarded formulas and decimal amounts", async () => {
    const h = await household();
    await juanPaysGroceries(h);
    await anaPays(h, "=SUM(A1)", 4_000);
    const fund = await newAccount(h.ana, "Fondo común", 500_000, "SHARED_FUND");
    const rent = await post(recordExpense, h.ana, "expenses", {
      description: "Arriendo",
      date: "2026-10-07",
      categoryId: h.groceries,
      amount: cop(10_000),
      payments: [{ memberId: null, accountId: fund, amount: cop(10_000) }],
      split: { method: "EQUAL", participants: [{ memberId: h.ana.memberId }, { memberId: h.juan.memberId }] },
    });
    expect(rent.status).toBe(201);

    const response = await exportAs(h.ana.personal, "format=csv");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="hearth-export-2026-10-31.zip"',
    );
    const entries = readZip(new Uint8Array(await response.arrayBuffer()));
    expect(entries.map((e) => e.name)).toEqual(["movements.csv", "accounts.csv", "categories.csv"]);
    for (const entry of entries) expect([...entry.data.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // TextDecoder drops the BOM checked above.
    const [movements, accounts, categories] = entries.map((e) => new TextDecoder().decode(e.data));

    const rows = movements!.split("\r\n");
    expect(rows[0]).toBe(
      "space,date,time,time zone,type,description,group,category,amount,currency,paid by,account,shares",
    );
    // The description is the sixth column; the seeded category is also named "Mercado".
    const described = (text: string) => rows.find((r) => r.split(",")[5] === text)!;
    const groceries = described("Mercado");
    expect(groceries).toContain(",16000.00,COP,Juan,,Ana: 8000.00; Juan: 8000.00");
    const formula = rows.find((r) => r.includes("SUM(A1)"))!;
    expect(formula).toContain(",'=SUM(A1),");
    expect(formula).toContain(",4000.00,COP,Ana,Bancolombia,");
    // The space's shared fund is named, as every member sees it; another member's personal account never is (D9).
    expect(described("Arriendo")).toContain(",10000.00,COP,Fondo común,Fondo común,");
    expect(groceries.split(",")[11]).toBe("");
    expect(movements).not.toContain("Davivienda");
    expect(accounts).toContain("Bancolombia,BANK,COP,2000000.00,no");
    expect(accounts).not.toContain("Davivienda");
    expect(categories!.split("\r\n")[0]).toBe("space,group,category,subcategory,catalog key,archived");
    expect(categories).toContain(",groceries,no");
  });

  it("keeps a balance adjustment's direction in the CSV: money out is a negative amount (#329)", async () => {
    const h = await household();
    for (const [description, pesos] of [
      ["Ajuste entra", 5_000],
      ["Ajuste sale", -2_000],
    ] as const) {
      const response = await post(recordAdjustment, h.ana.personal, "adjustments", {
        accountId: h.ana.account,
        amount: cop(pesos),
        date: "2026-10-07",
        description,
      });
      expect(response.status).toBe(201);
    }
    const response = await exportAs(h.ana.personal, "format=csv");
    const [movements] = readZip(new Uint8Array(await response.arrayBuffer())).map((e) =>
      new TextDecoder().decode(e.data),
    );
    const row = (text: string) =>
      movements!
        .split("\r\n")
        .find((r) => r.split(",")[5] === text)!
        .split(",");
    expect([row("Ajuste entra")[4], row("Ajuste entra")[8], row("Ajuste entra")[11]]).toEqual([
      "ADJUSTMENT",
      "5000.00",
      "Bancolombia",
    ]);
    expect([row("Ajuste sale")[4], row("Ajuste sale")[8], row("Ajuste sale")[11]]).toEqual([
      "ADJUSTMENT",
      "-2000.00",
      "Bancolombia",
    ]);
  });

  it("answers 429 TooManyRequests once a person exported a few times within a minute", async () => {
    const h = await household();
    for (let i = 0; i < LIMIT; i++) expect((await exportAs(h.ana.personal, "format=json")).status).toBe(200);

    expect(await problemOf(await exportAs(h.ana.personal, "format=json"))).toEqual([429, "TooManyRequests"]);
    // Another person's exports are counted apart.
    expect((await exportAs(h.juan.personal, "format=json")).status).toBe(200);
  });
  it("does not count an export refused as SpaceNotFound against the person's limit", async () => {
    const h = await household();
    for (let i = 0; i < LIMIT; i++) {
      expect(
        await problemOf(await exportAs(h.ana.personal, `format=json&spaceId=${h.juan.personal.spaceId}`)),
      ).toEqual([404, "SpaceNotFound"]);
    }

    expect((await exportAs(h.ana.personal, "format=json")).status).toBe(200);
  });

  it("exports an income, an own transfer, a settlement, a recurrence and a plan with its line, in JSON and CSV", async () => {
    const h = await householdWithFund();
    const nequi = await newAccount(h.ana.personal, "Nequi", 0);
    const recorded = async (response: Promise<Response>) => expect((await response).status).toBe(201);
    await recorded(
      post(recordIncome, h.ana.personal, "incomes", {
        description: "Salario",
        amount: cop(3_000_000),
        date: "2026-10-25",
        categoryId: await categoryWithKey(h.ana.personal, "salary"),
        accountId: h.ana.account,
      }),
    );
    await recorded(
      post(recordTransfer, h.ana.personal, "transfers", {
        description: "Ahorro",
        amount: cop(500_000),
        date: "2026-10-26",
        sourceAccountId: h.ana.account,
        destinationAccountId: nequi,
      }),
    );
    await juanPaysGroceries(h);
    // Ana pays Juan back from her account into his; his account stays out of her export (D9).
    await recorded(
      post(recordSettlement, h.ana, "settlements", {
        description: "Pago a Juan",
        date: "2026-10-27",
        amount: cop(8_000),
        payerMemberId: h.ana.memberId,
        receivingMemberId: h.juan.memberId,
        sourceAccountId: h.ana.account,
        destinationAccountId: h.juan.account,
      }),
    );
    await defined(h.ana, h.spaceId, rentBody(h));
    await homePlan(h, "2026-12");

    const json = await exportAs(h.ana.personal, "format=json");
    const text = await json.text();
    const spaces = (
      JSON.parse(text) as {
        spaces: {
          id: string;
          movements: Record<string, unknown>[];
          recurrences: unknown[];
          plans: unknown[];
        }[];
      }
    ).spaces;
    const personal = spaces.find((s) => s.id === h.ana.personal.spaceId)!;
    const shared = spaces.find((s) => s.id === h.spaceId)!;
    const bancolombia = { id: h.ana.account, name: "Bancolombia" };
    expect(personal.movements.find((m) => m.description === "Salario")).toMatchObject({
      type: "INCOME",
      category: { name: expect.any(String) },
      receiver: { name: "Ana" },
      destinationAccount: bancolombia,
    });
    expect(personal.movements.find((m) => m.description === "Ahorro")).toMatchObject({
      type: "TRANSFER",
      payer: null,
      sourceAccount: bancolombia,
      destinationAccount: { id: nequi, name: "Nequi" },
    });
    expect(shared.movements.find((m) => m.description === "Pago a Juan")).toMatchObject({
      type: "SETTLEMENT",
      payer: { name: "Ana" },
      receiver: { name: "Juan" },
      sourceAccount: bancolombia,
      destinationAccount: null,
      settlementReason: "PAYMENT",
    });
    expect(shared.recurrences).toEqual([
      expect.objectContaining({
        description: "Rent",
        type: "EXPENSE",
        amount: cop(1_200_000),
        schedule: { kind: "MONTHLY", day: 1 },
        startDate: "2026-12-01",
        status: "ACTIVE",
        categoryId: h.rent,
        payer: null,
        sourceAccount: { id: h.fund, name: "Household Fund" },
        destinationAccount: null,
      }),
    ]);
    expect(shared.plans).toEqual([
      expect.objectContaining({
        period: expect.objectContaining({ label: "2026-12" }),
        status: "ACTIVE",
        lines: [
          expect.objectContaining({
            name: "Home",
            plannedAmount: cop(1_470_000),
            funding: "DIRECT",
            categoryIds: [h.utilities],
          }),
        ],
      }),
    ]);
    expect(text).not.toContain(h.juan.account);

    const zip = await exportAs(h.ana.personal, "format=csv");
    const [movements] = readZip(new Uint8Array(await zip.arrayBuffer())).map((e) =>
      new TextDecoder().decode(e.data),
    );
    const columns = (description: string) =>
      movements!
        .split("\r\n")
        .map((r) => r.split(","))
        .find((c) => c[5] === description)!;
    // type, amount, paid by and account columns.
    const picked = (c: string[]) => [c[4], c[8], c[10], c[11]];
    expect(picked(columns("Salario"))).toEqual(["INCOME", "3000000.00", "Ana", "Bancolombia"]);
    expect(picked(columns("Ahorro"))).toEqual(["TRANSFER", "500000.00", "", "Bancolombia → Nequi"]);
    expect(picked(columns("Pago a Juan"))).toEqual(["SETTLEMENT", "8000.00", "Ana", "Bancolombia"]);
    expect(movements).not.toContain("Davivienda");
  });
});

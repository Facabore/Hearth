import { describe, expect, it } from "vitest";
import { localDate, type LocalDate } from "@/shared/kernel";
import { exportTables } from "./export-csv";
import { exportDocument } from "./export-document";
import type { ExportAccountSource, ExportSpaceSource } from "./export-source";

const d = (iso: string): LocalDate => {
  const date = localDate(iso);
  if (!date.ok) throw new Error(iso);
  return date.value;
};

const NO_TERMS = {
  creditLimit: null,
  cutOffDay: null,
  paymentDay: null,
  monthlyRatePpm: null,
  annualRatePpm: null,
  termDays: null,
  maturityDate: null,
  principal: null,
  termMonths: null,
};
const anaBank: ExportAccountSource = {
  id: "acc-ana",
  name: "Bancolombia",
  type: "BANK",
  currency: "COP",
  openingBalance: 200_000_000n,
  terms: NO_TERMS,
  archived: false,
};

const household: ExportSpaceSource = {
  id: "space-h",
  name: "Hogar",
  kind: "SHARED",
  currency: "COP",
  periodPolicy: { kind: "MONTHLY", day: 1 },
  role: "OWNER",
  archived: false,
  members: [
    { id: "m-ana", displayName: "Ana", role: "OWNER", guest: false, you: true, current: true },
    { id: "m-juan", displayName: "Juan", role: null, guest: false, you: false, current: false },
  ],
  accounts: [],
  categoryGroups: [
    {
      id: "g-home",
      name: "Hogar",
      key: "home",
      archived: false,
      categories: [
        {
          id: "c-groceries",
          name: "Mercado",
          key: "groceries",
          archived: false,
          subcategories: [{ id: "c-fruit", name: "Frutas", key: null, archived: false }],
        },
      ],
    },
  ],
  movements: [
    {
      id: "tx-1",
      type: "EXPENSE",
      date: d("2026-10-05"),
      occurredAt: new Date("2026-10-05T23:30:00Z"),
      timeZone: "America/Bogota",
      description: "Frutas",
      categoryId: "c-fruit",
      amount: 1_600_000n,
      currency: "COP",
      payments: [
        { memberId: "m-juan", accountId: "acc-juan", amount: 1_000_000n },
        { memberId: "m-ana", accountId: "acc-ana", amount: 600_000n },
      ],
      shares: [
        { memberId: "m-ana", amount: 800_000n, splitMethod: "EQUAL" },
        { memberId: "m-juan", amount: 800_000n, splitMethod: "EQUAL" },
      ],
      payerMemberId: null,
      receivingMemberId: null,
      sourceAccountId: null,
      destinationAccountId: null,
      settlementReason: null,
    },
  ],
  recurrences: [],
  plans: [],
};

const exported = exportDocument({
  person: { name: "Ana", locale: "es", timeZone: "America/Bogota" },
  exportedAt: new Date("2026-11-01T03:00:00Z"),
  spaces: [household],
  yourAccounts: [anaBank],
});

describe("exportDocument (design §3.6, D9)", () => {
  it("names the person's own account and never another member's, by id or by name", () => {
    const [movement] = exported.spaces[0]!.movements;
    expect(movement!.payments).toEqual([
      {
        member: { memberId: "m-juan", name: "Juan" },
        account: null,
        amount: { amount: "1000000", currency: "COP" },
      },
      {
        member: { memberId: "m-ana", name: "Ana" },
        account: { id: "acc-ana", name: "Bancolombia" },
        amount: { amount: "600000", currency: "COP" },
      },
    ]);
    expect(JSON.stringify(exported)).not.toContain("acc-juan");
  });

  it("lists only current members, and still names a former member's payments and shares (D15)", () => {
    const space = exported.spaces[0]!;
    expect(space.members.map((m) => m.name)).toEqual(["Ana"]);
    expect(space.movements[0]!.payments[0]!.member).toEqual({ memberId: "m-juan", name: "Juan" });
    expect(space.movements[0]!.shares.map((s) => s.member.name)).toEqual(["Ana", "Juan"]);
  });

  it("writes the time on the recorder's clock, the instant in RFC 3339 and the category with its group and parent", () => {
    const [movement] = exported.spaces[0]!.movements;
    expect(movement).toMatchObject({
      date: "2026-10-05",
      time: "18:30",
      timeZone: "America/Bogota",
      occurredAt: "2026-10-05T23:30:00.000Z",
      category: { id: "c-fruit", name: "Frutas", group: "Hogar", parent: "Mercado" },
    });
  });

  it("puts the format and version first", () => {
    expect(exported).toMatchObject({
      format: "hearth-export",
      version: 1,
      exportedAt: "2026-11-01T03:00:00.000Z",
    });
  });
});

describe("exportTables (design §3.6)", () => {
  it("writes one movement row with who paid, only the person's own account and the shares by name", () => {
    const rows = exportTables(exported).movements.split("\r\n");
    expect(rows[1]).toBe(
      "Hogar,2026-10-05,18:30,America/Bogota,EXPENSE,Frutas,Hogar,Mercado › Frutas,16000.00,COP,Juan; Ana,Bancolombia,Ana: 8000.00; Juan: 8000.00",
    );
  });

  it("writes a category row and one per subcategory, with the catalog key", () => {
    const rows = exportTables(exported).categories.split("\r\n");
    expect(rows.slice(1, 3)).toEqual(["Hogar,Hogar,Mercado,,groceries,no", "Hogar,Hogar,Mercado,Frutas,,no"]);
  });
});

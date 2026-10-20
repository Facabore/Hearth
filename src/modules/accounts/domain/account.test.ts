import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNT_TYPES,
  archiveAccount,
  iconOf,
  NO_ATTRIBUTES,
  openAccount,
  reviseAccount,
  type Account,
  type AccountId,
} from "./account";

const now = new Date("2026-10-12T12:00:00Z");
const open = (overrides: Partial<Parameters<typeof openAccount>[0]> = {}) =>
  openAccount({
    id: "acc-1" as AccountId,
    spaceId: "space-ana",
    spaceKind: "PERSONAL",
    ownerUserId: "u-ana",
    name: "Bancolombia",
    type: "BANK",
    openingBalance: 200_000_000n,
    now,
    siblings: [],
    ...overrides,
  });
const bancolombia: Account = unwrap(open());
const nequi: Account = unwrap(open({ id: "acc-2" as AccountId, name: "Nequi", type: "CASH" }));

describe("opening accounts (HU-E2-01)", () => {
  it("opens a personal account owned by the requester", () => {
    expect(bancolombia).toEqual({
      id: "acc-1",
      spaceId: "space-ana",
      name: "Bancolombia",
      type: "BANK",
      ownerUserId: "u-ana",
      openingBalance: 200_000_000n,
      archivedAt: null,
      createdAt: now,
      ...NO_ATTRIBUTES,
    });
  });

  it("allows a credit card to start negative", () => {
    expect(
      unwrap(open({ name: "Visa", type: "CREDIT_CARD", openingBalance: -35_000_000n })).openingBalance,
    ).toBe(-35_000_000n);
  });

  it("rejects a duplicate name in the space ignoring case", () => {
    expect(codeOf(open({ name: "  bancolombia ", siblings: [bancolombia] }))).toBe("AccountNameTaken");
  });

  it("keeps shared funds in shared spaces and personal types in personal spaces", () => {
    expect(codeOf(open({ type: "SHARED_FUND" }))).toBe("SharedFundRequiresSharedSpace");
    expect(codeOf(open({ spaceKind: "SHARED" }))).toBe("PersonalAccountRequiresPersonalSpace");
    expect(unwrap(open({ spaceKind: "SHARED", type: "SHARED_FUND" })).ownerUserId).toBeNull();
  });

  it.each(["   ", "x".repeat(61)])("rejects the name %j", (name) => {
    expect(codeOf(open({ name }))).toBe("InvalidAccountName");
  });
});

describe("revising and archiving accounts (HU-E2-03)", () => {
  it("corrects the opening balance and renames", () => {
    expect(
      unwrap(
        reviseAccount(bancolombia, { openingBalance: 210_000_000n, name: "Bancolombia Ahorros" }, [
          bancolombia,
          nequi,
        ]),
      ),
    ).toMatchObject({
      name: "Bancolombia Ahorros",
      openingBalance: 210_000_000n,
    });
  });

  it("never changes the type", () => {
    expect(codeOf(reviseAccount(bancolombia, { type: "SAVINGS" }, [bancolombia]))).toBe(
      "AccountTypeImmutable",
    );
    expect(codeOf(reviseAccount(bancolombia, { type: "BANK" }, [bancolombia]))).toBe("ok");
  });

  it("rejects renaming onto another account's name", () => {
    expect(codeOf(reviseAccount(bancolombia, { name: "NEQUI" }, [bancolombia, nequi]))).toBe(
      "AccountNameTaken",
    );
  });

  it("archives once and keeps the first archive time", () => {
    const archived = archiveAccount(bancolombia, now);
    expect(archiveAccount(archived, new Date("2027-01-01T00:00:00Z")).archivedAt).toEqual(now);
  });
});

describe("account types and common attributes (HU-E2-05)", () => {
  it("opens a wallet with its institution, last four digits, color and icon", () => {
    const wallet = unwrap(
      open({
        name: "Nequi",
        type: "WALLET",
        attributes: { institution: "Nequi", lastFour: "4821", color: "PINE", icon: "wallet" },
      }),
    );
    expect(wallet).toMatchObject({
      type: "WALLET",
      institution: "Nequi",
      lastFour: "4821",
      color: "PINE",
      icon: "wallet",
    });
  });

  it("leaves attributes empty and shows each type's default icon", () => {
    const cash = unwrap(open({ name: "Efectivo", type: "CASH" }));
    expect([cash.institution, cash.lastFour, cash.color, cash.icon, iconOf(cash)]).toEqual([
      null,
      null,
      null,
      null,
      "cash",
    ]);
    expect(ACCOUNT_TYPES.map((type) => iconOf({ type, icon: null }))).toEqual([
      "cash",
      "bank",
      "wallet",
      "card",
      "piggy",
      "trend",
      "coins",
      "dots",
      "users",
    ]);
  });

  it("shows an explicit icon instead of the type's default", () => {
    const loan = unwrap(open({ name: "Carro", type: "LOAN", attributes: { icon: "car" } }));
    expect(iconOf(loan)).toBe("car");
  });

  it.each(["WALLET", "INVESTMENT", "LOAN", "OTHER"] as const)(
    "keeps %s accounts in personal spaces",
    (type) => {
      expect(codeOf(open({ type, spaceKind: "SHARED" }))).toBe("PersonalAccountRequiresPersonalSpace");
    },
  );

  it("changes and clears attributes, and never the type, whatever else the change holds", () => {
    const wallet = unwrap(
      open({
        type: "WALLET",
        attributes: { color: "PINE", institution: "Nequi", icon: "car", lastFour: "4821" },
      }),
    );
    const revised = unwrap(
      reviseAccount(
        wallet,
        { attributes: { color: "EMBER", institution: null, icon: null, lastFour: null } },
        [wallet],
      ),
    );
    expect(revised).toMatchObject({ color: "EMBER", institution: null, icon: null, lastFour: null });
    expect(iconOf(revised)).toBe("wallet");
    expect(codeOf(reviseAccount(wallet, { type: "BANK", attributes: { color: "SKY" } }, [wallet]))).toBe(
      "AccountTypeImmutable",
    );
  });
});

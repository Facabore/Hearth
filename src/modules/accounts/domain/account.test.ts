import { describe, expect, it } from "vitest";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import { archiveAccount, openAccount, reviseAccount, type Account, type AccountId } from "./account";

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

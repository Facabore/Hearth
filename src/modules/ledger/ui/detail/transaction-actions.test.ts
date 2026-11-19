import { describe, expect, it } from "vitest";
import { cop, guestDto, memberDto, transactionDto } from "../../../../../tests/support/ui/dto";
import { actionsFor, type Viewer } from "./transaction-actions";

const ana: Viewer = { userId: "u-ana", role: "OWNER", memberId: "m-ana" };
const luis: Viewer = { userId: "u-luis", role: "MEMBER", memberId: "m-luis" };
const members = [
  memberDto({ id: "m-ana", userId: "u-ana", displayName: "Ana" }),
  memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan" }),
  memberDto({ id: "m-luis", userId: "u-luis", displayName: "Luis" }),
  guestDto({ id: "m-pedro", displayName: "Pedro" }),
];
const BOTH = { edit: true, delete: true, note: null };
const NONE = { edit: false, delete: false, note: null };
const paidBy = (memberId: string | null, accountId: string | null, createdBy = "u-ana") =>
  transactionDto({
    type: "EXPENSE",
    createdBy,
    amount: cop(100_000),
    payments: [{ memberId, accountId, amount: cop(100_000) }],
    shares: [{ memberId: "m-ana", amount: cop(100_000), splitMethod: "EQUAL" }],
  });
const settlement = transactionDto({
  type: "SETTLEMENT",
  createdBy: "u-ana",
  payerMemberId: "m-juan",
  receivingMemberId: "m-ana",
});
const contribution = transactionDto({
  type: "TRANSFER",
  createdBy: "u-juan",
  payerMemberId: "m-juan",
  sourceAccountId: "a-juan",
  destinationAccountId: "a-fund",
});

describe("who sees Editar and Eliminar (ruling P344, amending P190)", () => {
  it("offers both on any movement to whoever records money: the recorder's, a guest's, the fund's and another member's", () => {
    for (const tx of [
      paidBy("m-ana", "a-bank"),
      paidBy("m-pedro", null),
      paidBy(null, "a-fund"),
      paidBy("m-juan", "a-juan", "u-juan"),
    ])
      expect(actionsFor(tx, ana, members)).toEqual(BOTH);
  });

  it("lets a MEMBER correct a movement someone else recorded, even one they are no party to (S1)", () => {
    expect(actionsFor(paidBy("m-juan", "a-juan", "u-juan"), luis, members)).toEqual(BOTH);
    expect(actionsFor(settlement, luis, members)).toEqual(BOTH);
    expect(actionsFor(contribution, luis, members)).toEqual(BOTH);
  });

  it("offers both on a settlement and on another member's fund contribution (S4)", () => {
    expect(actionsFor(settlement, ana, members)).toEqual(BOTH);
    expect(actionsFor(contribution, ana, members)).toEqual(BOTH);
    expect(actionsFor({ ...settlement, settlementReason: "FORGIVENESS" }, ana, members)).toEqual(BOTH);
  });

  it("gives a VIEWER nothing at all (HU-E4-06)", () => {
    const viewer: Viewer = { ...luis, role: "VIEWER" };
    for (const tx of [paidBy("m-ana", "a-bank"), settlement, contribution])
      expect(actionsFor(tx, viewer, members)).toEqual(NONE);
  });

  it("keeps a guest's contribution deleted and recorded again, since it has no account to stay a transfer with (#195)", () => {
    expect(
      actionsFor({ ...contribution, payerMemberId: "m-pedro", sourceAccountId: null }, ana, members),
    ).toEqual({ edit: false, delete: true, note: { key: "CONTRIBUTION" } });
  });

  it("offers an income and an own transfer to anyone who records money", () => {
    const income = transactionDto({ type: "INCOME", createdBy: "u-juan", receivingMemberId: "m-juan" });
    const transfer = transactionDto({
      type: "TRANSFER",
      createdBy: "u-juan",
      sourceAccountId: "a-1",
      destinationAccountId: "a-2",
    });
    expect(actionsFor(income, ana, members)).toEqual(BOTH);
    expect(actionsFor(transfer, ana, members)).toEqual(BOTH);
  });

  it("in a personal space, where there are no members, everything is the viewer's own", () => {
    expect(actionsFor(paidBy("m-ana", "a-bank"), { ...ana, memberId: null }, [])).toEqual(BOTH);
  });

  it("offers only Eliminar on a balance adjustment (design Q4)", () => {
    expect(actionsFor(transactionDto({ type: "ADJUSTMENT" }), luis, members)).toEqual({
      edit: false,
      delete: true,
      note: null,
    });
  });

  it("offers only Eliminar on either half of an expense paid for the fund or of a gift, saying why (D26, P322)", () => {
    const pair = { edit: false, delete: true, note: { key: "PAID_FOR_FUND" } };
    const expense = { ...paidBy(null, "a-fund"), linkedTransactionId: "t-c" };
    const half = { ...contribution, payerMemberId: "m-ana", linkedTransactionId: "t-e" };
    expect(actionsFor(expense, ana, members)).toEqual(pair);
    expect(actionsFor(half, luis, members)).toEqual(pair);
    expect(
      actionsFor({ ...settlement, settlementReason: "GIFT", linkedTransactionId: "t-g" }, luis, members),
    ).toEqual({ edit: false, delete: true, note: { key: "GIFT" } });
    expect(actionsFor(expense, { ...ana, role: "VIEWER" }, members)).toEqual(NONE);
  });
});

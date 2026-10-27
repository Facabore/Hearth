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
const paidBy = (memberId: string | null, accountId: string | null, createdBy = "u-ana") =>
  transactionDto({
    type: "EXPENSE",
    createdBy,
    amount: cop(100_000),
    payments: [{ memberId, accountId, amount: cop(100_000) }],
    shares: [{ memberId: "m-ana", amount: cop(100_000), splitMethod: "EQUAL" }],
  });

describe("who sees Editar and Eliminar (ruling P190, D9)", () => {
  it("offers both to whoever's money it is: the recorder, a guest's or the fund's payment", () => {
    for (const tx of [paidBy("m-ana", "a-bank"), paidBy("m-pedro", null), paidBy(null, "a-fund")])
      expect(actionsFor(tx, ana, members)).toEqual({ edit: true, delete: true, note: null });
  });

  it("lets an OWNER delete but not edit an expense paid from another member's account", () => {
    expect(actionsFor(paidBy("m-juan", "a-juan", "u-juan"), ana, members)).toEqual({
      edit: false,
      delete: true,
      note: { key: "onlyOwner", name: "Juan" },
    });
  });

  it("gives a MEMBER nothing on someone else's transaction and a VIEWER nothing at all (HU-E4-06)", () => {
    expect(actionsFor(paidBy("m-ana", "a-bank"), luis, members)).toEqual({
      edit: false,
      delete: false,
      note: null,
    });
    expect(actionsFor(paidBy("m-ana", "a-bank"), { ...ana, role: "VIEWER" }, members)).toEqual({
      edit: false,
      delete: false,
      note: null,
    });
  });

  it("offers only Eliminar on a settlement, saying why, and Editar on a contribution only to its payer (issue #195)", () => {
    const settlement = transactionDto({
      type: "SETTLEMENT",
      payerMemberId: "m-juan",
      receivingMemberId: "m-ana",
    });
    const contribution = transactionDto({
      type: "TRANSFER",
      payerMemberId: "m-ana",
      destinationAccountId: "a-fund",
    });
    expect(actionsFor(settlement, ana, members)).toEqual({
      edit: false,
      delete: true,
      note: { key: "SETTLEMENT" },
    });
    expect(actionsFor(contribution, ana, members)).toEqual({ edit: true, delete: true, note: null });
    expect(actionsFor({ ...contribution, payerMemberId: "m-juan" }, ana, members)).toEqual({
      edit: false,
      delete: true,
      note: { key: "onlyOwner", name: "Juan" },
    });
  });

  it("lets only the receiver edit an income and only the creator edit an own transfer", () => {
    const income = transactionDto({ type: "INCOME", createdBy: "u-juan", receivingMemberId: "m-juan" });
    const transfer = transactionDto({
      type: "TRANSFER",
      createdBy: "u-juan",
      sourceAccountId: "a-1",
      destinationAccountId: "a-2",
    });
    expect(actionsFor(income, ana, members).edit).toBe(false);
    expect(actionsFor(transfer, ana, members)).toEqual({
      edit: false,
      delete: true,
      note: { key: "onlyOwner", name: "Juan" },
    });
    expect(actionsFor(transfer, { ...ana, userId: "u-juan", memberId: "m-juan" }, members).edit).toBe(true);
  });

  it("in a personal space, where there are no members, everything is the viewer's own", () => {
    expect(actionsFor(paidBy("m-ana", "a-bank"), { ...ana, memberId: null }, [])).toEqual({
      edit: true,
      delete: true,
      note: null,
    });
  });
});

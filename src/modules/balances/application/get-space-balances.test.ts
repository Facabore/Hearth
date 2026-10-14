import { describe, expect, it } from "vitest";
import type { Expense } from "@/modules/ledger/application";
import { createSpaceAccess } from "@/modules/spaces/application";
import { Money } from "@/shared/kernel";
import { codeOf, unwrap } from "../../../../tests/support/fakes";
import {
  ACCOUNTS,
  anExpense,
  aSettlement,
  aTransfer,
  InMemoryTransactions,
} from "../../../../tests/support/in-memory-ledger";
import { householdSpace, InMemorySpaceStore, memberOf } from "../../../../tests/support/in-memory-spaces";
import { createGetSpaceBalances, type GetSpaceBalances } from "./get-space-balances";

const ANA = memberOf("Ana", "OWNER", 0);
const JUAN = memberOf("Juan", "MEMBER", 1);
const pesos = (n: bigint) => n * 100n;

/** An expense of Household paid in full by `payer` (null: the shared fund), split equally among `participants`. */
const paid = (
  payer: string | null,
  amount: bigint,
  participants: readonly string[],
  overrides: Partial<Expense> = {},
): Expense => {
  const parts = unwrap(unwrap(Money.ofMinor(amount, "COP")).allocate(participants.map(() => 1)));
  return anExpense("2026-10-05", amount, {
    spaceId: "space-household",
    payments: [{ memberId: payer, accountId: payer === null ? ACCOUNTS.householdFund.id : null, amount }],
    shares: participants.map((memberId, index) => ({
      memberId,
      amount: parts[index]!.minor,
      splitMethod: "EQUAL" as const,
    })),
    ...overrides,
  });
};

/** A contribution of `amount` by `memberId` to the Household shared fund. */
const contribution = (memberId: string, amount: bigint) =>
  aTransfer("2026-10-02", amount, {
    spaceId: "space-household",
    destinationAccountId: ACCOUNTS.householdFund.id,
    payerMemberId: memberId,
  });

/** HU-E5-01 Background: "Household" with Ana and Juan unless other members are given. */
const world = (members = [ANA, JUAN]) => {
  const spaces = new InMemorySpaceStore();
  spaces.seed(householdSpace(members));
  const ledger = new InMemoryTransactions();
  const getBalances = createGetSpaceBalances({
    access: createSpaceAccess(spaces),
    members: spaces,
    source: ledger,
  });
  return { ledger, getBalances };
};

const netsOf = async (getBalances: GetSpaceBalances, userId = "u-ana") =>
  unwrap(await getBalances({ spaceId: "space-household", userId })).members.map(
    (balance) => [balance.memberId, balance.net] as const,
  );

describe("GetSpaceBalances (HU-E5-01)", () => {
  it("turns one equal split into a debt from Juan to Ana, in the space currency", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    expect(unwrap(await getBalances({ spaceId: "space-household", userId: "u-juan" }))).toEqual({
      spaceId: "space-household",
      currency: "COP",
      members: [
        { memberId: "member-ana", net: pesos(150_000n) },
        { memberId: "member-juan", net: -pesos(150_000n) },
      ],
    });
  });

  it("nets debts out across expenses", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    await ledger.add(paid("member-juan", pesos(100_000n), ["member-ana", "member-juan"]));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(100_000n)],
      ["member-juan", -pesos(100_000n)],
    ]);
  });

  it("ignores fund-paid expenses and fund contributions (D5, Review Focus 5)", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    await ledger.add(paid(null, pesos(1_200_000n), ["member-ana", "member-juan"]));
    await ledger.add(contribution("member-ana", pesos(480_000n)));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(150_000n)],
      ["member-juan", -pesos(150_000n)],
    ]);
  });

  it("creates no debt between members when the shared fund pays an expense they share (D5)", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid(null, pesos(1_200_000n), ["member-ana", "member-juan"]));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
    ]);
  });

  it("leaves a contribution to the shared fund out of the contributor's balance (D5)", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(contribution("member-ana", pesos(480_000n)));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", 0n],
      ["member-juan", 0n],
    ]);
  });

  it("excludes soft-deleted expenses: only live rows move the nets (Review Focus 5)", async () => {
    const { ledger, getBalances } = world();
    const deletedAt = new Date("2026-10-06T00:00:00Z");
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    await ledger.add(paid("member-juan", pesos(1_000_000n), ["member-ana", "member-juan"], { deletedAt }));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(150_000n)],
      ["member-juan", -pesos(150_000n)],
    ]);
  });

  it("excludes soft-deleted settlements: only live rows move the nets (Review Focus 5)", async () => {
    const { ledger, getBalances } = world();
    const deletedAt = new Date("2026-10-06T00:00:00Z");
    await ledger.add(paid("member-ana", pesos(300_000n), ["member-ana", "member-juan"]));
    await ledger.add(aSettlement("2026-10-30", pesos(50_000n)));
    await ledger.add(aSettlement("2026-10-31", pesos(120_000n), { deletedAt }));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(100_000n)],
      ["member-juan", -pesos(100_000n)],
    ]);
  });

  it("raises the payer's balance and lowers the receiver's with each settlement", async () => {
    const { ledger, getBalances } = world();
    await ledger.add(paid("member-ana", pesos(2_400_000n), ["member-ana", "member-juan"]));
    await ledger.add(aSettlement("2026-10-30", pesos(500_000n)));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", pesos(700_000n)],
      ["member-juan", -pesos(700_000n)],
    ]);
    await ledger.add(aSettlement("2026-10-31", pesos(800_000n)));
    expect(await netsOf(getBalances)).toEqual([
      ["member-ana", -pesos(100_000n)],
      ["member-juan", pesos(100_000n)],
    ]);
  });

  it("includes guests and always sums to zero (Review Focus 5)", async () => {
    const { ledger, getBalances } = world([ANA, JUAN, memberOf("Pedro", null, 2)]);
    const everyone = ["member-ana", "member-juan", "member-pedro"];
    await ledger.add(paid("member-pedro", pesos(90_000n), everyone));
    // 100,000 among three: Ana 33,334, Juan 33,333, Pedro 33,333.
    await ledger.add(paid("member-ana", pesos(100_000n), everyone));
    const nets = await netsOf(getBalances);
    expect(nets).toEqual([
      ["member-ana", pesos(36_666n)],
      ["member-juan", -pesos(63_333n)],
      ["member-pedro", pesos(26_667n)],
    ]);
    expect(nets.reduce((sum, [, net]) => sum + net, 0n)).toBe(0n);
  });

  it("sums to zero over a mix of member-paid and fund-paid expenses, settlements, contributions and deletions", async () => {
    const { ledger, getBalances } = world([ANA, JUAN, memberOf("Pedro", null, 2)]);
    const everyone = ["member-ana", "member-juan", "member-pedro"];
    await ledger.add(paid("member-ana", pesos(100_000n), everyone));
    await ledger.add(paid("member-pedro", pesos(90_000n), ["member-juan", "member-pedro"]));
    await ledger.add(paid(null, pesos(60_000n), everyone));
    await ledger.add(
      paid("member-juan", pesos(45_000n), everyone, { deletedAt: new Date("2026-10-06T00:00:00Z") }),
    );
    await ledger.add(contribution("member-juan", pesos(200_000n)));
    await ledger.add(aSettlement("2026-10-20", pesos(30_000n)));
    await ledger.add(
      aSettlement("2026-10-21", pesos(12_345n), {
        payerMemberId: "member-pedro",
        receivingMemberId: "member-ana",
      }),
    );
    const nets = await netsOf(getBalances);
    expect(nets.some(([, net]) => net !== 0n)).toBe(true);
    expect(nets.reduce((sum, [, net]) => sum + net, 0n)).toBe(0n);
  });

  it("lets every member read, viewers included, and hides the space from non-members", async () => {
    const { getBalances } = world([ANA, JUAN, memberOf("Sofi", "VIEWER", 2)]);
    expect(codeOf(await getBalances({ spaceId: "space-household", userId: "u-sofi" }))).toBe("ok");
    expect(codeOf(await getBalances({ spaceId: "space-household", userId: "u-marta" }))).toBe(
      "SpaceNotFound",
    );
  });
});

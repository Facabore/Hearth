import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as acceptClaim } from "@/app/api/v1/claims/[token]/accept/route";
import { POST as directSplit } from "@/app/api/v1/direct-splits/route";
import { POST as acceptInvitation } from "@/app/api/v1/invitations/[token]/accept/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import {
  GET as getAccount,
  PATCH as updateAccount,
} from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { GET as listAccounts, POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import {
  GET as listCategories,
  POST as createCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as archiveCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { PATCH as renameCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { POST as createCategoryGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordFundContribution } from "@/app/api/v1/spaces/[spaceId]/fund-contributions/route";
import { POST as createClaimLink } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/claim-links/route";
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { POST as revokeInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/[invitationId]/revoke/route";
import { POST as createInvitation } from "@/app/api/v1/spaces/[spaceId]/invitations/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { PATCH as changeRole } from "@/app/api/v1/spaces/[spaceId]/members/[memberId]/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { GET as getSpace, PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { GET as listAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import {
  DELETE as deleteTransaction,
  GET as getTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as listTransactions } from "@/app/api/v1/spaces/[spaceId]/transactions/route";
import { POST as recordTransfer } from "@/app/api/v1/spaces/[spaceId]/transfers/route";
import { setContainerForTests, type Container } from "@/composition/container";
import {
  call,
  problemOf,
  registerUser,
  startTestApp,
  type RouteHandler,
  type TestUser,
} from "../support/app";
import { addGuest, cop, household, memberIdOf, newAccount, paysEqually, settles } from "../support/ledger";
import { actingIn, claimLink, tokenOf } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

interface Extra {
  readonly params?: Record<string, string>;
  readonly body?: unknown;
}

/** Status and problem code, "" for a response without one: a write that escapes the guard reads as a row, not a crash. */
const answerOf = async (response: Response): Promise<[number, string]> => {
  const text = await response.text();
  return [response.status, text === "" ? "" : ((JSON.parse(text) as { code?: string }).code ?? "")];
};

/**
 * HU-E1-09: Household with OWNER Ana, MEMBER Juan and the guest Pedro, settled and then archived, with one
 * of everything a write could target: a transaction, a shared fund, a category and its group, a pending
 * invitation link and a claim link for Pedro.
 */
const archivedHousehold = async () => {
  const h = await household();
  const pedro = await addGuest(h, "Pedro");
  const groceries = await paysEqually(h.ana, 100_000, [h.ana.memberId, h.juan.memberId], h.groceries);
  await settles(h.juan, h.juan.memberId, h.ana.memberId, 50_000);
  const fund = await newAccount(h.ana, "Fund", 0, "SHARED_FUND");
  const invited = await call(createInvitation, "POST", `/api/v1/spaces/${h.spaceId}/invitations`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
    body: { kind: "LINK", role: "MEMBER" },
  });
  const invitation = (await invited.json()) as { invitation: { id: string }; url: string };
  const claim = await claimLink(h.ana, h.spaceId, pedro);
  const tree = await call(listCategories, "GET", `/api/v1/spaces/${h.spaceId}/categories`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  const groupId = ((await tree.json()) as { items: { id: string }[] }).items[0]!.id;
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  expect(archived.status).toBe(204);
  /** `user` calls `handler` on `resource` of Household. */
  const as =
    (user: TestUser) =>
    (handler: RouteHandler, method: string, resource: string, extra: Extra = {}) =>
      call(handler, method, `/api/v1/spaces/${h.spaceId}${resource}`, {
        user,
        params: { spaceId: h.spaceId, ...extra.params },
        body: extra.body,
      });
  return {
    h,
    pedro,
    tx: groceries.id,
    fund,
    groupId,
    invitationId: invitation.invitation.id,
    invitationToken: tokenOf(invitation.url),
    claim,
    ana: as(h.ana),
    juan: as(h.juan),
  };
};

describe("an archived space only reads (HU-E1-09, Review Focus 4)", () => {
  it("answers every read with 200, for any member", async () => {
    const { tx, fund, juan } = await archivedHousehold();
    const transaction = { params: { transactionId: tx } };
    const reads: [string, () => Promise<Response>][] = [
      ["the space", () => juan(getSpace, "GET", "")],
      ["its members", () => juan(listMembers, "GET", "/members")],
      ["its periods", () => juan(listPeriods, "GET", "/periods")],
      ["its transactions", () => juan(listTransactions, "GET", "/transactions?period=2026-10")],
      ["one transaction", () => juan(getTransaction, "GET", `/transactions/${tx}`, transaction)],
      ["its audit", () => juan(listAudit, "GET", `/transactions/${tx}/audit`, transaction)],
      ["its balances", () => juan(getBalances, "GET", "/balances")],
      ["its accounts", () => juan(listAccounts, "GET", "/accounts")],
      ["one account", () => juan(getAccount, "GET", `/accounts/${fund}`, { params: { accountId: fund } })],
      ["its categories", () => juan(listCategories, "GET", "/categories")],
    ];
    const answers: [string, number][] = [];
    for (const [what, read] of reads) answers.push([what, (await read()).status]);
    expect(answers).toEqual(reads.map(([what]) => [what, 200]));
  });

  it("answers every space-scoped write endpoint of M1–M2-C with 409 SpaceArchived", async () => {
    const { h, pedro, tx, fund, groupId, invitationId, ana, juan } = await archivedHousehold();
    const category = h.groceries;
    const onCategory = { params: { categoryId: category } };
    const onGroup = { params: { groupId } };
    const onFund = { params: { accountId: fund } };
    const onTransaction = { params: { transactionId: tx } };
    const onPedro = { params: { memberId: pedro } };
    const writes: [string, () => Promise<Response>][] = [
      ["rename the space", () => ana(updateSpace, "PATCH", "", { body: { name: "Old house" } })],
      ["archive it again", () => ana(archiveSpace, "POST", "/archive")],
      ["leave it", () => juan(leaveSpace, "POST", "/leave")],
      [
        "create an invitation",
        () => ana(createInvitation, "POST", "/invitations", { body: { kind: "LINK", role: "MEMBER" } }),
      ],
      [
        "revoke an invitation",
        () =>
          ana(revokeInvitation, "POST", `/invitations/${invitationId}/revoke`, { params: { invitationId } }),
      ],
      ["add a guest", () => ana(addGuestMember, "POST", "/guests", { body: { displayName: "Luis" } })],
      ["remove a guest", () => ana(removeGuestMember, "DELETE", `/guests/${pedro}`, onPedro)],
      ["create a claim link", () => ana(createClaimLink, "POST", `/guests/${pedro}/claim-links`, onPedro)],
      [
        "change a role",
        () =>
          ana(changeRole, "PATCH", `/members/${h.juan.memberId}`, {
            params: { memberId: h.juan.memberId },
            body: { role: "ADMIN" },
          }),
      ],
      [
        "create a category group",
        () => ana(createCategoryGroup, "POST", "/category-groups", { body: { name: "Trips" } }),
      ],
      [
        "rename a category group",
        () =>
          ana(renameCategoryGroup, "PATCH", `/category-groups/${groupId}`, {
            ...onGroup,
            body: { name: "Food" },
          }),
      ],
      [
        "archive a category group",
        () => ana(archiveCategoryGroup, "POST", `/category-groups/${groupId}/archive`, onGroup),
      ],
      [
        "create a category",
        () => ana(createCategory, "POST", "/categories", { body: { groupId, name: "Snacks" } }),
      ],
      [
        "update a category",
        () =>
          ana(updateCategory, "PATCH", `/categories/${category}`, {
            ...onCategory,
            body: { name: "Market" },
          }),
      ],
      [
        "archive a category",
        () => ana(archiveCategory, "POST", `/categories/${category}/archive`, onCategory),
      ],
      [
        "restore a category",
        () => ana(restoreCategory, "POST", `/categories/${category}/restore`, onCategory),
      ],
      ["delete a category", () => ana(deleteCategory, "DELETE", `/categories/${category}`, onCategory)],
      [
        "create an account",
        () =>
          ana(createAccount, "POST", "/accounts", {
            body: { name: "Pot", type: "SHARED_FUND", openingBalance: cop(0) },
          }),
      ],
      [
        "update an account",
        () => ana(updateAccount, "PATCH", `/accounts/${fund}`, { ...onFund, body: { name: "Pot" } }),
      ],
      ["archive an account", () => ana(archiveAccount, "POST", `/accounts/${fund}/archive`, onFund)],
      [
        "record an expense",
        () =>
          ana(recordExpense, "POST", "/expenses", {
            body: { categoryId: category, amount: cop(50_000), accountId: h.ana.account },
          }),
      ],
      [
        "record an income",
        () =>
          ana(recordIncome, "POST", "/incomes", {
            body: { categoryId: category, amount: cop(10_000), accountId: fund },
          }),
      ],
      [
        "record a transfer",
        () =>
          ana(recordTransfer, "POST", "/transfers", {
            body: { amount: cop(10_000), sourceAccountId: h.ana.account, destinationAccountId: fund },
          }),
      ],
      [
        "record a fund contribution",
        () =>
          ana(recordFundContribution, "POST", "/fund-contributions", {
            body: { amount: cop(10_000), fundAccountId: fund, sourceAccountId: h.ana.account },
          }),
      ],
      [
        "record a settlement",
        () =>
          ana(recordSettlement, "POST", "/settlements", {
            body: { amount: cop(10_000), payerMemberId: h.juan.memberId, receivingMemberId: h.ana.memberId },
          }),
      ],
      [
        "edit a transaction",
        () =>
          ana(editTransaction, "PATCH", `/transactions/${tx}`, {
            ...onTransaction,
            body: { description: "Old" },
          }),
      ],
      ["delete a transaction", () => ana(deleteTransaction, "DELETE", `/transactions/${tx}`, onTransaction)],
    ];
    const answers: [string, [number, string]][] = [];
    for (const [what, write] of writes) answers.push([what, await answerOf(await write())]);
    expect(answers).toEqual(writes.map(([what]) => [what, [409, "SpaceArchived"]]));
  });

  it("refuses joining through an invitation or a claim link of an archived space, adding nobody and consuming nothing (ruling O5)", async () => {
    const { h, invitationId, invitationToken, claim } = await archivedHousehold();
    const joined = await call(acceptInvitation, "POST", `/api/v1/invitations/${invitationToken}/accept`, {
      user: await registerUser("Luis"),
      params: { token: invitationToken },
    });
    expect(await problemOf(joined)).toEqual([409, "SpaceArchived"]);
    const claimed = await call(acceptClaim, "POST", `/api/v1/claims/${claim.token}/accept`, {
      user: await registerUser("Marta"),
      params: { token: claim.token },
    });
    expect(await problemOf(claimed)).toEqual([409, "SpaceArchived"]);
    const { rows } = await app.pool.query(
      "SELECT display_name, kind, user_id, left_at FROM space_members WHERE space_id = $1 ORDER BY joined_at, id",
      [h.spaceId],
    );
    expect(
      rows.map((r: { display_name: string; kind: string; user_id: string | null; left_at: Date | null }) => [
        r.display_name,
        r.kind,
        r.user_id === null,
        r.left_at,
      ]),
    ).toEqual([
      ["Ana", "USER", false, null],
      ["Juan", "USER", false, null],
      ["Pedro", "GUEST", true, null],
    ]);
    // Neither link was consumed: both are still PENDING, accepted by nobody.
    const { rows: links } = await app.pool.query(
      "SELECT id, status, accepted_at, accepted_by_user_id FROM space_invitations WHERE id = ANY($1::uuid[])",
      [[invitationId, claim.id]],
    );
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toMatchObject({ status: "PENDING", accepted_at: null, accepted_by_user_id: null });
    }
  });

  it("refuses a direct split with the guest of an archived direct space", async () => {
    const ana = await registerUser("Ana");
    const bancolombia = await newAccount(ana, "Bancolombia", 2_000_000);
    const dinner = {
      counterpart: { kind: "GUEST", displayName: "Pedro" },
      description: "Dinner",
      date: "2026-10-14",
      categoryKey: "restaurants",
      amount: cop(120_000),
      accountId: bancolombia,
    };
    const first = await call(directSplit, "POST", "/api/v1/direct-splits", { user: ana, body: dinner });
    const { spaceId } = (await first.json()) as { spaceId: string };
    const pedroId = await memberIdOf(ana, spaceId, "Pedro");
    await settles(actingIn(ana, spaceId), pedroId, await memberIdOf(ana, spaceId, "Ana"), 60_000);
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, {
      user: ana,
      params: { spaceId },
    });
    expect(archived.status).toBe(204);
    const again = { ...dinner, counterpart: { kind: "MEMBER", memberId: pedroId } };
    expect(
      await problemOf(await call(directSplit, "POST", "/api/v1/direct-splits", { user: ana, body: again })),
    ).toEqual([409, "SpaceArchived"]);
  });
});

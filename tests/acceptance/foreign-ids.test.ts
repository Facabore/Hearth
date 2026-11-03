import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as updateAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { POST as archiveAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/archive/route";
import { POST as restoreAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/restore/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import {
  DELETE as deleteCategory,
  PATCH as updateCategory,
} from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/route";
import { POST as archiveCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/archive/route";
import { POST as restoreCategory } from "@/app/api/v1/spaces/[spaceId]/categories/[categoryId]/restore/route";
import { PATCH as renameGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/route";
import { POST as archiveGroup } from "@/app/api/v1/spaces/[spaceId]/category-groups/[groupId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import {
  DELETE as deleteTransaction,
  PATCH as editTransaction,
} from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/route";
import { GET as transactionAudit } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/audit/route";
import { POST as restoreTransaction } from "@/app/api/v1/spaces/[spaceId]/transactions/[transactionId]/restore/route";
import { setContainerForTests, type Container } from "@/composition/container";
import {
  call,
  problemOf,
  registerUser,
  startTestApp,
  type RouteHandler,
  type TestUser,
} from "../support/app";
import { categoryWithKey, cop, inSpace, newAccount, post, type TransactionDto } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Ana's own space, and Juan's ids of each kind: real rows, but of another space. */
const twoSpaces = async () => {
  const ana = await registerUser("Ana");
  const juan = await registerUser("Juan");
  const account = await newAccount(juan, "Davivienda", 100_000);
  const category = await categoryWithKey(juan, "groceries");
  const tree = await call(listCategories, "GET", inSpace(juan, "categories"), {
    user: juan,
    params: { spaceId: juan.spaceId },
  });
  const { items } = (await tree.json()) as { items: { id: string }[] };
  const expense = await post(recordExpense, juan, "expenses", {
    amount: cop(10_000),
    date: "2026-10-05",
    categoryId: category,
    accountId: account,
  });
  const transaction = ((await expense.json()) as TransactionDto).id;
  return { ana, juans: { account, category, group: items[0]!.id, transaction } };
};

/** A write route: handler, method, resource, id param, path suffix, body and the 404 code it answers. */
type Route = readonly [RouteHandler, string, string, keyof typeof kindOf, string, unknown, string];
const kindOf = {
  categoryId: "category",
  groupId: "group",
  accountId: "account",
  transactionId: "transaction",
} as const;

/** `user` calls `route` on `<resource>/<id><suffix>` of their own space. */
const onOwnSpace = (user: TestUser, [handler, method, resource, param, suffix, body]: Route, id: string) =>
  call(handler, method, inSpace(user, `${resource}/${id}${suffix}`), {
    user,
    params: { spaceId: user.spaceId, [param]: id },
    body,
  });

describe("ids of another space or of nothing, on the write routes (M1 review)", () => {
  const routes = [
    [updateCategory, "PATCH", "categories", "categoryId", "", { name: "Mine" }, "CategoryNotFound"],
    [deleteCategory, "DELETE", "categories", "categoryId", "", undefined, "CategoryNotFound"],
    [archiveCategory, "POST", "categories", "categoryId", "/archive", undefined, "CategoryNotFound"],
    [restoreCategory, "POST", "categories", "categoryId", "/restore", undefined, "CategoryNotFound"],
    [renameGroup, "PATCH", "category-groups", "groupId", "", { name: "Mine" }, "CategoryGroupNotFound"],
    [archiveGroup, "POST", "category-groups", "groupId", "/archive", undefined, "CategoryGroupNotFound"],
    [updateAccount, "PATCH", "accounts", "accountId", "", { name: "Mine" }, "AccountNotFound"],
    [archiveAccount, "POST", "accounts", "accountId", "/archive", undefined, "AccountNotFound"],
    [restoreAccount, "POST", "accounts", "accountId", "/restore", undefined, "AccountNotFound"],
    [
      editTransaction,
      "PATCH",
      "transactions",
      "transactionId",
      "",
      { description: "Mine" },
      "TransactionNotFound",
    ],
    [deleteTransaction, "DELETE", "transactions", "transactionId", "", undefined, "TransactionNotFound"],
    [
      restoreTransaction,
      "POST",
      "transactions",
      "transactionId",
      "/restore",
      undefined,
      "TransactionNotFound",
    ],
    [transactionAudit, "GET", "transactions", "transactionId", "/audit", undefined, "TransactionNotFound"],
  ] as const satisfies readonly Route[];

  it.each(routes)(
    "%s %s %s/{id}%s answers 404 for a foreign, an unknown and a malformed id",
    async (...route) => {
      const { ana, juans } = await twoSpaces();
      const [, , , param, , , code] = route;
      for (const id of [juans[kindOf[param]], randomUUID(), "not-a-uuid"]) {
        expect(await problemOf(await onOwnSpace(ana, route, id)), id).toEqual([404, code]);
      }
    },
  );

  it("leaves the other space's rows as they were", async () => {
    const { ana, juans } = await twoSpaces();
    for (const route of routes) await onOwnSpace(ana, route, juans[kindOf[route[3]]]);
    const { rows: accounts } = await app.pool.query("SELECT name, archived_at FROM accounts WHERE id = $1", [
      juans.account,
    ]);
    expect(accounts).toEqual([{ name: "Davivienda", archived_at: null }]);
    const { rows: categories } = await app.pool.query(
      "SELECT name, archived_at, deleted_at FROM categories WHERE id = $1",
      [juans.category],
    );
    expect(categories).toEqual([{ name: "Mercado", archived_at: null, deleted_at: null }]);
    const { rows: transactions } = await app.pool.query(
      "SELECT description, deleted_at, version FROM transactions WHERE id = $1",
      [juans.transaction],
    );
    expect(transactions).toEqual([{ description: "", deleted_at: null, version: 1 }]);
  });
});

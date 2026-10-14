import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { GET as getAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/[accountId]/route";
import { GET as listCategories } from "@/app/api/v1/spaces/[spaceId]/categories/route";
import { POST as addGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/route";
import { GET as listMembers } from "@/app/api/v1/spaces/[spaceId]/members/route";
import { GET as getBalances } from "@/app/api/v1/spaces/[spaceId]/balances/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { POST as recordSettlement } from "@/app/api/v1/spaces/[spaceId]/settlements/route";
import { call, registerUser, type RouteHandler, type TestUser } from "./app";
import { actingIn, joinAs, newSharedSpace } from "./spaces";

export interface MoneyDto {
  amount: string;
  currency: string;
}
export interface TransactionDto {
  id: string;
  type: string;
  description: string;
  date: string;
  amount: MoneyDto;
  categoryId: string | null;
  payments: { memberId: string | null; accountId: string | null; amount: MoneyDto }[];
  shares: { memberId: string; amount: MoneyDto; splitMethod: string }[];
  sourceAccountId: string | null;
  destinationAccountId: string | null;
  receivingMemberId: string | null;
  payerMemberId: string | null;
  createdBy: string;
  version: number;
}

/** Whole pesos on the wire: COP has two minor digits. */
export const cop = (pesos: number): MoneyDto => ({ amount: String(pesos * 100), currency: "COP" });
export const inSpace = (user: TestUser, resource: string) => `/api/v1/spaces/${user.spaceId}/${resource}`;

/** Creates an account in `user.spaceId` (a BANK account unless `type` says otherwise); returns its id. */
export const newAccount = async (
  user: TestUser,
  name: string,
  pesos: number,
  type = "BANK",
): Promise<string> => {
  const response = await call(createAccount, "POST", inSpace(user, "accounts"), {
    user,
    params: { spaceId: user.spaceId },
    body: { name, type, openingBalance: cop(pesos) },
  });
  if (response.status !== 201) throw new Error(`account creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** The seeded category of `user.spaceId` with the catalog `key`. */
export const categoryWithKey = async (user: TestUser, key: string): Promise<string> => {
  const response = await call(listCategories, "GET", inSpace(user, "categories"), {
    user,
    params: { spaceId: user.spaceId },
  });
  const { items } = (await response.json()) as {
    items: { categories: { id: string; key: string | null }[] }[];
  };
  return items.flatMap((g) => g.categories).find((c) => c.key === key)!.id;
};

/** POSTs `body` to `resource` of `spaceOf`'s space as `user`. */
export const post = (
  handler: RouteHandler,
  user: TestUser,
  resource: string,
  body: unknown,
  headers: Record<string, string> = {},
  spaceOf: TestUser = user,
) =>
  call(handler, "POST", inSpace(spaceOf, resource), {
    user,
    params: { spaceId: spaceOf.spaceId },
    body,
    headers,
  });

/** The computed balance of an account of `user.spaceId`. */
export const balanceOf = async (user: TestUser, accountId: string): Promise<MoneyDto> => {
  const response = await call(getAccount, "GET", inSpace(user, `accounts/${accountId}`), {
    user,
    params: { spaceId: user.spaceId, accountId },
  });
  return ((await response.json()) as { balance: MoneyDto }).balance;
};

/** The member id of `displayName` in `spaceId`, as `viewer` sees the member list. */
export const memberIdOf = async (viewer: TestUser, spaceId: string, displayName: string): Promise<string> => {
  const response = await call(listMembers, "GET", `/api/v1/spaces/${spaceId}/members`, {
    user: viewer,
    params: { spaceId },
  });
  const { items } = (await response.json()) as { items: { id: string; displayName: string }[] };
  const member = items.find((m) => m.displayName === displayName);
  if (!member) throw new Error(`no member named ${displayName}`);
  return member.id;
};

/** A registered household member: acting in the household, with their personal space and account. */
export interface HouseholdMember extends TestUser {
  readonly memberId: string;
  /** The same user acting in their personal space. */
  readonly personal: TestUser;
  /** Their personal BANK account, opened with 2,000,000 COP. */
  readonly account: string;
}

export interface Household {
  readonly spaceId: string;
  /** The seeded "groceries" category of the household. */
  readonly groceries: string;
  /** OWNER, with "Bancolombia". */
  readonly ana: HouseholdMember;
  /** MEMBER, with "Davivienda". */
  readonly juan: HouseholdMember;
}

const memberIn = async (
  user: TestUser,
  spaceId: string,
  name: string,
  accountName: string,
): Promise<HouseholdMember> => ({
  ...actingIn(user, spaceId),
  personal: user,
  memberId: await memberIdOf(user, spaceId, name),
  account: await newAccount(user, accountName, 2_000_000),
});

/** HU-E4-07 Background: "Household" with OWNER Ana (Bancolombia) and MEMBER Juan (Davivienda), 2,000,000 COP each. */
export const household = async (): Promise<Household> => {
  const ana = await registerUser("Ana");
  const juan = await registerUser("Juan");
  const spaceId = await newSharedSpace(ana);
  await joinAs(ana, spaceId, juan, "MEMBER");
  return {
    spaceId,
    groceries: await categoryWithKey(actingIn(ana, spaceId), "groceries"),
    ana: await memberIn(ana, spaceId, "Ana", "Bancolombia"),
    juan: await memberIn(juan, spaceId, "Juan", "Davivienda"),
  };
};

/** Another registered member (Luis, Sofi, ...) joins the household with `role` and a 2,000,000 COP account. */
export const joinHousehold = async (
  h: Household,
  name: string,
  role: "ADMIN" | "MEMBER" | "VIEWER",
): Promise<HouseholdMember> => {
  const user = await registerUser(name);
  await joinAs(h.ana, h.spaceId, user, role);
  return memberIn(user, h.spaceId, name, `${name} bank`);
};

/** Ana adds the guest `name` to the household; returns the guest's member id. */
export const addGuest = async (h: Household, name: string): Promise<string> => {
  const response = await call(addGuestMember, "POST", `/api/v1/spaces/${h.spaceId}/guests`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
    body: { displayName: name },
  });
  if (response.status !== 201) throw new Error(`guest creation failed with status ${response.status}`);
  return ((await response.json()) as { id: string }).id;
};

/** HU-E5-01: the household's balances as `user` reads them, as `[memberId, net]` pairs in join order. */
export const balancesOf = async (user: TestUser, spaceId: string): Promise<[string, MoneyDto][]> => {
  const response = await call(getBalances, "GET", `/api/v1/spaces/${spaceId}/balances`, {
    user,
    params: { spaceId },
  });
  if (response.status !== 200) throw new Error(`balances failed with status ${response.status}`);
  const { members } = (await response.json()) as { members: { memberId: string; net: MoneyDto }[] };
  return members.map((m): [string, MoneyDto] => [m.memberId, m.net]);
};

/** `payer` pays `pesos` on 2026-10-05 from their own account, split equally among `participants`. */
export const paysEqually = async (
  payer: HouseholdMember,
  pesos: number,
  participants: readonly string[],
  categoryId: string,
  description = "Groceries",
): Promise<TransactionDto> => {
  const response = await post(recordExpense, payer, "expenses", {
    description,
    date: "2026-10-05",
    categoryId,
    amount: cop(pesos),
    payments: [{ memberId: payer.memberId, accountId: payer.account, amount: cop(pesos) }],
    split: { method: "EQUAL", participants: participants.map((memberId) => ({ memberId })) },
  });
  if (response.status !== 201) throw new Error(`expense failed with status ${response.status}`);
  return (await response.json()) as TransactionDto;
};

/** `recorder` records on 2026-10-30 that `payerMemberId` paid `receivingMemberId` `pesos`, outside the app. */
export const settles = async (
  recorder: TestUser,
  payerMemberId: string,
  receivingMemberId: string,
  pesos: number,
): Promise<TransactionDto> => {
  const response = await post(recordSettlement, recorder, "settlements", {
    date: "2026-10-30",
    amount: cop(pesos),
    payerMemberId,
    receivingMemberId,
  });
  if (response.status !== 201) throw new Error(`settlement failed with status ${response.status}`);
  return (await response.json()) as TransactionDto;
};

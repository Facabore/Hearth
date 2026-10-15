import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as createAccount } from "@/app/api/v1/spaces/[spaceId]/accounts/route";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as recordExpense } from "@/app/api/v1/spaces/[spaceId]/expenses/route";
import { DELETE as removeGuestMember } from "@/app/api/v1/spaces/[spaceId]/guests/[memberId]/route";
import { POST as recordIncome } from "@/app/api/v1/spaces/[spaceId]/incomes/route";
import { GET as suggestionRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacity-suggestion/route";
import { PUT as putCapacitiesRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/capacities/route";
import { PATCH as updateSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";
import {
  getSuggestion,
  newPlan,
  planOf,
  plansPath,
  putCapacities,
  setCapacities,
} from "../support/budgeting";
import {
  addGuest,
  categoryWithKey,
  cop,
  household,
  joinHousehold,
  memberIdOf,
  newAccount,
  post,
  type MoneyDto,
} from "../support/ledger";
import { joinAs } from "../support/spaces";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** HU-E6-02 Background: a DRAFT plan for 2026-11 in Household with Ana and Juan. */
const draft = async () => {
  const h = await household();
  const plan = await newPlan(h.ana, h.spaceId, "2026-11");
  return { h, planId: plan.id };
};

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };

/** `user` records an income in their own personal space, into `account`: the income a suggestion reads (D17). */
const earns = async (user: TestUser, account: string, date: string, amount: MoneyDto) => {
  const response = await post(recordIncome, user, "incomes", {
    description: "Salary",
    date,
    categoryId: await categoryWithKey(user, "salary"),
    amount,
    accountId: account,
  });
  if (response.status !== 201) throw new Error(`income failed with status ${response.status}`);
};

/** A PUT with an arbitrary body, for requests the typed helper cannot build. */
const putRaw = (user: TestUser, spaceId: string, planId: string, body: unknown, headers = {}) =>
  call(putCapacitiesRoute, "PUT", plansPath(spaceId, `/${planId}/capacities`), {
    user,
    params: { spaceId, planId },
    body,
    headers,
  });

describe("member capacities (HU-E6-02)", () => {
  it("sets capacities that define the proportional ratio Ana 40.00 % and Juan 60.00 % (golden)", async () => {
    const { h, planId } = await draft();
    const response = await putCapacities(h.ana, h.spaceId, planId, [
      [h.ana.memberId, 1_600_000],
      [h.juan.memberId, 2_400_000],
    ]);
    expect([response.status, response.headers.get("etag")]).toEqual([200, '"2"']);
    const plan = await response.json();
    expect(plan.totalCapacity).toEqual(cop(4_000_000));
    expect(plan.capacities).toEqual([
      { memberId: h.ana.memberId, amount: cop(1_600_000), share: "40.00" },
      { memberId: h.juan.memberId, amount: cop(2_400_000), share: "60.00" },
    ]);
  });

  it("answers the whole plan with its new ETag and keeps the members it does not list (P5, P9)", async () => {
    const { h, planId } = await draft();
    await setCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1_600_000]]);
    const response = await putCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    expect([response.status, response.headers.get("etag")]).toEqual([200, '"3"']);
    const plan = await response.json();
    expect([plan.id, plan.version, plan.status, plan.lines]).toEqual([planId, 3, "DRAFT", []]);
    expect(plan.capacities).toEqual([
      { memberId: h.ana.memberId, amount: cop(1_600_000), share: "44.44" },
      { memberId: h.juan.memberId, amount: cop(2_000_000), share: "55.56" },
    ]);
    expect(plan.totalCapacity).toEqual(cop(3_600_000));
    expect(await planOf(h.ana, h.spaceId, planId)).toEqual(plan);
  });

  it("rejects a negative capacity, a capacity for Marta, and an empty request", async () => {
    const { h, planId } = await draft();
    const negative = await putCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, -100_000]]);
    expect(await problemOf(negative)).toEqual([422, "InvalidCapacity"]);
    const marta = await registerUser("Marta");
    const martaMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const foreign = await putCapacities(h.ana, h.spaceId, planId, [[martaMember, 100_000]]);
    expect(await problemOf(foreign)).toEqual([422, "NotASpaceMember"]);
    expect(await problemOf(await putCapacities(h.ana, h.spaceId, planId, []))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("changes nothing when one entry of the request is refused", async () => {
    const { h, planId } = await draft();
    const marta = await registerUser("Marta");
    const martaMember = await memberIdOf(marta, marta.spaceId, "Marta");
    const mixed = await putCapacities(h.ana, h.spaceId, planId, [
      [h.ana.memberId, 1_600_000],
      [martaMember, 100_000],
    ]);
    expect(await problemOf(mixed)).toEqual([422, "NotASpaceMember"]);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect([plan.version, plan.totalCapacity]).toEqual([1, cop(0)]);
  });

  it("refuses a member listed twice, an unknown id, a malformed plan id and more than 100 entries", async () => {
    const { h, planId } = await draft();
    const twice = await putCapacities(h.ana, h.spaceId, planId, [
      [h.juan.memberId, 1],
      [h.juan.memberId, 2],
    ]);
    expect(await problemOf(twice)).toEqual([422, "InvalidCapacity"]);
    const unknown = await putCapacities(h.ana, h.spaceId, planId, [["not-a-member", 1]]);
    expect(await problemOf(unknown)).toEqual([422, "NotASpaceMember"]);
    const malformed = await putCapacities(h.ana, h.spaceId, "not-a-uuid", [[h.ana.memberId, 1]]);
    expect(await problemOf(malformed)).toEqual([404, "BudgetPlanNotFound"]);
    const many = Array.from({ length: 101 }, (_, i) => ({ memberId: `member-${i}`, amount: cop(1) }));
    expect(await problemOf(await putRaw(h.ana, h.spaceId, planId, { capacities: many }))).toEqual([
      422,
      "ValidationFailed",
    ]);
    expect((await planOf(h.ana, h.spaceId, planId)).version).toBe(1);
  });

  it("refuses a capacity in another currency or in a currency the app does not know", async () => {
    const { h, planId } = await draft();
    const entry = (currency: string) => ({
      capacities: [{ memberId: h.ana.memberId, amount: { amount: "100", currency } }],
    });
    expect(await problemOf(await putRaw(h.ana, h.spaceId, planId, entry("USD")))).toEqual([
      422,
      "CurrencyMismatch",
    ]);
    expect(await problemOf(await putRaw(h.ana, h.spaceId, planId, entry("ZZZ")))).toEqual([
      422,
      "UnknownCurrency",
    ]);
    expect((await planOf(h.ana, h.spaceId, planId)).version).toBe(1);
  });

  it("lets the guest Pedro hold capacity, and Juan the MEMBER set only his own (D15, D17)", async () => {
    const { h, planId } = await draft();
    const pedro = await addGuest(h, "Pedro");
    await setCapacities(h.ana, h.spaceId, planId, [[pedro, 300_000]]);
    await setCapacities(h.juan, h.spaceId, planId, [[h.juan.memberId, 2_400_000]]);
    const anas = await putCapacities(h.juan, h.spaceId, planId, [[h.ana.memberId, 1]]);
    expect(await problemOf(anas)).toEqual([403, "InsufficientRole"]);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect(plan.capacities.map((c) => [c.memberId, c.amount])).toEqual([
      [h.ana.memberId, cop(0)],
      [h.juan.memberId, cop(2_400_000)],
      [pedro, cop(300_000)],
    ]);
  });

  it("refuses a MEMBER who lists the guest Pedro, or himself together with Ana, and changes nothing", async () => {
    const { h, planId } = await draft();
    const pedro = await addGuest(h, "Pedro");
    const guest = await putCapacities(h.juan, h.spaceId, planId, [[pedro, 1]]);
    expect(await problemOf(guest)).toEqual([403, "InsufficientRole"]);
    const both = await putCapacities(h.juan, h.spaceId, planId, [
      [h.juan.memberId, 1],
      [h.ana.memberId, 1],
    ]);
    expect(await problemOf(both)).toEqual([403, "InsufficientRole"]);
    expect((await planOf(h.ana, h.spaceId, planId)).version).toBe(1);
  });

  it("lets an ADMIN set anyone's capacity, the guest Pedro's included", async () => {
    const { h, planId } = await draft();
    const luis = await joinHousehold(h, "Luis", "ADMIN");
    const pedro = await addGuest(h, "Pedro");
    const plan = await setCapacities(luis, h.spaceId, planId, [
      [h.juan.memberId, 2_400_000],
      [pedro, 300_000],
    ]);
    expect(plan.totalCapacity).toEqual(cop(2_700_000));
  });

  it("refuses a VIEWER, even for his own capacity, and a stranger gets 404", async () => {
    const { h, planId } = await draft();
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    expect(await problemOf(await putCapacities(vera, h.spaceId, planId, [[vera.memberId, 1]]))).toEqual([
      403,
      "InsufficientRole",
    ]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await putCapacities(marta, h.spaceId, planId, [[h.ana.memberId, 1]]))).toEqual([
      404,
      "SpaceNotFound",
    ]);
    const anonymous = await call(putCapacitiesRoute, "PUT", plansPath(h.spaceId, `/${planId}/capacities`), {
      params: { spaceId: h.spaceId, planId },
      body: { capacities: [{ memberId: h.ana.memberId, amount: cop(1) }] },
    });
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    expect((await planOf(h.ana, h.spaceId, planId)).version).toBe(1);
  });

  it("answers 404 for a plan the space does not have", async () => {
    const { h } = await draft();
    const other = await newPlan(h.ana, h.spaceId, "2026-12");
    const marta = await registerUser("Marta");
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    expect(await problemOf(await putCapacities(h.ana, h.spaceId, foreign.id, [[h.ana.memberId, 1]]))).toEqual(
      [404, "BudgetPlanNotFound"],
    );
    expect((await planOf(h.ana, h.spaceId, other.id)).version).toBe(1);
    // The plan the request targeted, Marta's, is untouched as well.
    const martas = await planOf(marta, marta.spaceId, foreign.id);
    expect([martas.version, martas.totalCapacity]).toEqual([1, cop(0)]);
  });

  it("refuses a change in an archived space (HU-E1-09)", async () => {
    const { h, planId } = await draft();
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const refused = await putCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1_600_000]]);
    expect(await problemOf(refused)).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).totalCapacity).toEqual(cop(0));
  });

  it("drops a guest who was removed from the total and refuses a capacity for him (P7)", async () => {
    const { h, planId } = await draft();
    const pedro = await addGuest(h, "Pedro");
    await setCapacities(h.ana, h.spaceId, planId, [
      [h.ana.memberId, 1_600_000],
      [pedro, 300_000],
    ]);
    const removed = await call(removeGuestMember, "DELETE", `/api/v1/spaces/${h.spaceId}/guests/${pedro}`, {
      user: h.ana,
      params: { spaceId: h.spaceId, memberId: pedro },
    });
    expect(removed.status).toBe(204);
    const refused = await putCapacities(h.ana, h.spaceId, planId, [[pedro, 1]]);
    expect(await problemOf(refused)).toEqual([422, "NotASpaceMember"]);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect(plan.capacities.map((c) => c.memberId)).toEqual([h.ana.memberId, h.juan.memberId]);
    expect(plan.totalCapacity).toEqual(cop(1_600_000));
  });

  it("refuses a stale If-Match with 412 and changes nothing (Review Focus 1)", async () => {
    const { h, planId } = await draft();
    await setCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1_600_000]], 1);
    const stale = await putCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1]], 1);
    expect(await problemOf(stale)).toEqual([412, "PreconditionFailed"]);
    const plan = await planOf(h.ana, h.spaceId, planId);
    expect([plan.version, plan.capacities[0]!.amount]).toEqual([2, cop(1_600_000)]);
  });

  it("refuses a malformed If-Match with 412, and writes without If-Match too", async () => {
    const { h, planId } = await draft();
    const body = { capacities: [{ memberId: h.ana.memberId, amount: cop(1_600_000) }] };
    const weak = await putRaw(h.ana, h.spaceId, planId, body, { "if-match": 'W/"1"' });
    expect(await problemOf(weak)).toEqual([412, "PreconditionFailed"]);
    expect((await planOf(h.ana, h.spaceId, planId)).version).toBe(1);
    expect((await putRaw(h.ana, h.spaceId, planId, body)).status).toBe(200);
  });

  it("gives each plan of a semi-monthly space its own capacities (HU-E6-01)", async () => {
    const ana = await registerUser("Ana");
    const semi = await call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } },
    });
    expect(semi.status).toBe(200);
    const h1 = await newPlan(ana, ana.spaceId, "2026-11 H1");
    const h2 = await newPlan(ana, ana.spaceId, "2026-11 H2");
    const member = h1.capacities[0]!.memberId;
    await setCapacities(ana, ana.spaceId, h1.id, [[member, 800_000]]);
    expect((await planOf(ana, ana.spaceId, h1.id)).totalCapacity).toEqual(cop(800_000));
    expect((await planOf(ana, ana.spaceId, h2.id)).totalCapacity).toEqual(cop(0));
  });
});

describe("capacity suggestion (HU-E6-02, D17)", () => {
  it("suggests Ana her 2026-10 personal income, saves nothing, and never shows it to Juan", async () => {
    const { h, planId } = await draft();
    await earns(h.ana.personal, h.ana.account, "2026-10-15", cop(1_650_000));
    const suggestion = await getSuggestion(h.ana, h.spaceId, planId);
    expect([suggestion.status, await suggestion.json()]).toEqual([
      200,
      { memberId: h.ana.memberId, period: OCTOBER, suggested: cop(1_650_000) },
    ]);
    expect((await planOf(h.ana, h.spaceId, planId)).capacities[0]!.amount).toEqual(cop(0));
    const juans = await (await getSuggestion(h.juan, h.spaceId, planId)).text();
    expect(JSON.parse(juans)).toEqual({ memberId: h.juan.memberId, period: OCTOBER, suggested: cop(0) });
    expect(juans).not.toContain("165000000");
    expect(JSON.stringify(await planOf(h.juan, h.spaceId, planId))).not.toContain("165000000");
    await setCapacities(h.ana, h.spaceId, planId, [[h.ana.memberId, 1_650_000]]);
    expect((await planOf(h.juan, h.spaceId, planId)).capacities[0]!.amount).toEqual(cop(1_650_000));
  });

  it("counts the income dated within the previous period, first and last day included, and nothing else", async () => {
    const { h, planId } = await draft();
    const personal = h.ana.personal;
    await earns(personal, h.ana.account, "2026-09-30", cop(100_000));
    await earns(personal, h.ana.account, "2026-10-01", cop(200_000));
    await earns(personal, h.ana.account, "2026-10-31", cop(300_000));
    await earns(personal, h.ana.account, "2026-11-01", cop(400_000));
    const spent = await post(recordExpense, personal, "expenses", {
      description: "Market",
      date: "2026-10-10",
      categoryId: await categoryWithKey(personal, "groceries"),
      amount: cop(50_000),
      accountId: h.ana.account,
    });
    expect(spent.status).toBe(201);
    const suggestion = await (await getSuggestion(h.ana, h.spaceId, planId)).json();
    expect(suggestion.suggested).toEqual(cop(500_000));
  });

  it("answers each member with the income of their own personal space only", async () => {
    const { h, planId } = await draft();
    await earns(h.ana.personal, h.ana.account, "2026-10-15", cop(1_650_000));
    await earns(h.juan.personal, h.juan.account, "2026-10-20", cop(2_400_000));
    const juans = await (await getSuggestion(h.juan, h.spaceId, planId)).json();
    expect(juans).toEqual({ memberId: h.juan.memberId, period: OCTOBER, suggested: cop(2_400_000) });
    const anas = await (await getSuggestion(h.ana, h.spaceId, planId)).json();
    expect(anas).toEqual({ memberId: h.ana.memberId, period: OCTOBER, suggested: cop(1_650_000) });
  });

  it("lets a VIEWER read her own suggestion", async () => {
    const { h, planId } = await draft();
    const vera = await joinHousehold(h, "Vera", "VIEWER");
    await earns(vera.personal, vera.account, "2026-10-28", cop(900_000));
    const response = await getSuggestion(vera, h.spaceId, planId);
    expect([response.status, await response.json()]).toEqual([
      200,
      { memberId: vera.memberId, period: OCTOBER, suggested: cop(900_000) },
    ]);
  });

  it("suggests nothing, not zero, when the personal space keeps another currency (D6)", async () => {
    const { h, planId } = await draft();
    const sofi = await registerUser("Sofi");
    const dollars = await call(updateSpace, "PATCH", `/api/v1/spaces/${sofi.spaceId}`, {
      user: sofi,
      params: { spaceId: sofi.spaceId },
      body: { currency: "USD" },
    });
    expect(dollars.status).toBe(200);
    const usd = (minor: string) => ({ amount: minor, currency: "USD" });
    const account = await call(createAccount, "POST", `/api/v1/spaces/${sofi.spaceId}/accounts`, {
      user: sofi,
      params: { spaceId: sofi.spaceId },
      body: { name: "Chase", type: "BANK", openingBalance: usd("0") },
    });
    expect(account.status).toBe(201);
    await earns(sofi, ((await account.json()) as { id: string }).id, "2026-10-15", usd("500000"));
    await joinAs(h.ana, h.spaceId, sofi, "MEMBER");
    const response = await getSuggestion(sofi, h.spaceId, planId);
    expect([response.status, await response.json()]).toEqual([
      200,
      { memberId: await memberIdOf(h.ana, h.spaceId, "Sofi"), period: OCTOBER, suggested: null },
    ]);
  });

  it("hides the plan from a stranger and from other ids, and asks for a session", async () => {
    const { h, planId } = await draft();
    const marta = await registerUser("Marta");
    expect(await problemOf(await getSuggestion(marta, h.spaceId, planId))).toEqual([404, "SpaceNotFound"]);
    const foreign = await newPlan(marta, marta.spaceId, "2026-11");
    expect(await problemOf(await getSuggestion(h.ana, h.spaceId, foreign.id))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(await problemOf(await getSuggestion(h.ana, h.spaceId, "not-a-uuid"))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(await problemOf(await getSuggestion(h.ana, "not-a-uuid", planId))).toEqual([404, "SpaceNotFound"]);
    const anonymous = await call(
      suggestionRoute,
      "GET",
      plansPath(h.spaceId, `/${planId}/capacity-suggestion`),
      {
        params: { spaceId: h.spaceId, planId },
      },
    );
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
  });

  it("keeps answering in an archived space, since asking only reads (HU-E1-09)", async () => {
    const { h, planId } = await draft();
    await earns(h.ana.personal, h.ana.account, "2026-10-15", cop(1_650_000));
    const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
      user: h.ana,
      params: { spaceId: h.spaceId },
    });
    expect(archived.status).toBe(204);
    const response = await getSuggestion(h.ana, h.spaceId, planId);
    expect([response.status, (await response.json()).suggested]).toEqual([200, cop(1_650_000)]);
  });

  it("looks at the previous period of the policy: 2026-11 H1 for a 2026-11 H2 plan", async () => {
    const ana = await registerUser("Ana");
    const semi = await call(updateSpace, "PATCH", `/api/v1/spaces/${ana.spaceId}`, {
      user: ana,
      params: { spaceId: ana.spaceId },
      body: { periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } },
    });
    expect(semi.status).toBe(200);
    const h2 = await newPlan(ana, ana.spaceId, "2026-11 H2");
    const account = await newAccount(ana, "Bancolombia", 0);
    await earns(ana, account, "2026-11-10", cop(700_000));
    await earns(ana, account, "2026-11-20", cop(50_000));
    const response = await getSuggestion(ana, ana.spaceId, h2.id);
    expect([response.status, await response.json()]).toEqual([
      200,
      {
        memberId: h2.capacities[0]!.memberId,
        period: { label: "2026-11 H1", startDate: "2026-11-01", endDate: "2026-11-15" },
        suggested: cop(700_000),
      },
    ]);
  });
});

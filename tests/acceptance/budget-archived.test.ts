import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import {
  createPlan,
  deleteLine,
  getPlan,
  getSuggestion,
  lineNamed,
  patchLine,
  percentAllocation,
  planOf,
  postLine,
  putAllocation,
  putCapacities,
  putCategories,
  referencePlan,
} from "../support/budgeting";
import { categoryWithKey } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/**
 * HU-E1-09: the reference plan's Household, settled (nothing recorded) and then archived. Groceries map to Home and
 * Home is split 30/70 first, so a refused write has mappings and allocations it could touch.
 */
const archivedPlan = async () => {
  const ref = await referencePlan();
  const { h, planId, lineId } = ref;
  const groceries = await categoryWithKey(h.ana, "groceries");
  expect((await putCategories(h.ana, h.spaceId, planId, lineId("Home"), [groceries])).status).toBe(200);
  const split = percentAllocation([h.ana.memberId, "30"], [h.juan.memberId, "70"]);
  expect((await putAllocation(h.ana, h.spaceId, planId, lineId("Home"), split)).status).toBe(200);
  const plan = await planOf(h.ana, h.spaceId, planId);
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${h.spaceId}/archive`, {
    user: h.ana,
    params: { spaceId: h.spaceId },
  });
  expect(archived.status).toBe(204);
  return { ...ref, plan };
};

/** Every row the plan owns, as PostgreSQL holds it: a refused write must leave all of it as it was (D8, spec 7). */
const stored = async (spaceId: string, planId: string) => {
  const rows = async (sql: string, id: string) => (await app.pool.query(sql, [id])).rows;
  return {
    plans: await rows("SELECT * FROM budget_plans WHERE space_id = $1 ORDER BY id", spaceId),
    capacities: await rows(
      "SELECT * FROM budget_member_capacities WHERE plan_id = $1 ORDER BY member_id",
      planId,
    ),
    lines: await rows("SELECT * FROM budget_lines WHERE plan_id = $1 ORDER BY id", planId),
    mappings: await rows("SELECT * FROM budget_line_categories WHERE plan_id = $1 ORDER BY id", planId),
    allocations: await rows(
      "SELECT a.* FROM budget_allocations a JOIN budget_lines l ON l.id = a.line_id WHERE l.plan_id = $1 ORDER BY a.id",
      planId,
    ),
  };
};

describe("plans of an archived space only read (HU-E1-09, Review Focus 5)", () => {
  it("answers both plan reads with 200, for the OWNER and for a MEMBER", async () => {
    const { h, planId } = await archivedPlan();
    const reads: [string, () => Promise<Response>][] = [
      ["the plan, as Ana", () => getPlan(h.ana, h.spaceId, planId)],
      ["the capacity suggestion, as Ana", () => getSuggestion(h.ana, h.spaceId, planId)],
      ["the plan, as Juan", () => getPlan(h.juan, h.spaceId, planId)],
      ["the capacity suggestion, as Juan", () => getSuggestion(h.juan, h.spaceId, planId)],
    ];
    const answers: [string, number][] = [];
    for (const [what, read] of reads) answers.push([what, (await read()).status]);
    expect(answers).toEqual(reads.map(([what]) => [what, 200]));
  });

  it("answers every plan write endpoint of M3-A with 409 SpaceArchived and changes nothing", async () => {
    const { h, planId, lineId, plan } = await archivedPlan();
    const home = lineId("Home");
    const before = await stored(h.spaceId, planId);
    expect([
      before.plans.length,
      before.capacities.length,
      before.lines.length,
      before.mappings.length,
      before.allocations.length,
    ]).toEqual([1, 2, 4, 1, 2]);
    const writesAs = (user: TestUser, who: string): [string, () => Promise<Response>][] => [
      [`${who} creates a plan`, () => createPlan(user, h.spaceId, "2026-12")],
      [`${who} sets capacities`, () => putCapacities(user, h.spaceId, planId, [[h.ana.memberId, 1]])],
      [`${who} adds a line`, () => postLine(user, h.spaceId, planId, { name: "Travel", pesos: 1 })],
      [`${who} edits a line`, () => patchLine(user, h.spaceId, planId, home, { name: "House" })],
      [`${who} removes a line`, () => deleteLine(user, h.spaceId, planId, home)],
      [`${who} maps categories`, () => putCategories(user, h.spaceId, planId, home, [])],
      [`${who} allocates a line`, () => putAllocation(user, h.spaceId, planId, home, { rule: "NONE" })],
    ];
    const writes = [...writesAs(h.ana, "Ana"), ...writesAs(h.juan, "Juan")];
    const answers: [string, number, string][] = [];
    for (const [what, write] of writes) answers.push([what, ...(await problemOf(await write()))]);
    expect(answers).toEqual(writes.map(([what]) => [what, 409, "SpaceArchived"]));
    expect(await stored(h.spaceId, planId)).toEqual(before);
    const after = await planOf(h.ana, h.spaceId, planId);
    expect([after.version, lineNamed(after, "Home").name, after.lines.length]).toEqual([
      plan.version,
      "Home",
      4,
    ]);
  });
});

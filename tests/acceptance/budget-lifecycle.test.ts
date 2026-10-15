import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as archiveSpace } from "@/app/api/v1/spaces/[spaceId]/archive/route";
import { POST as leaveSpace } from "@/app/api/v1/spaces/[spaceId]/leave/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import {
  activatePlan,
  getPlan,
  planOf,
  putAllocation,
  referencePlan,
  setCapacities,
  type PlanDto,
} from "../support/budgeting";
import { joinHousehold } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** Activates the plan and returns it; fails the test unless 200. */
const activated = async (...args: Parameters<typeof activatePlan>): Promise<PlanDto> => {
  const response = await activatePlan(...args);
  expect(response.status).toBe(200);
  return (await response.json()) as PlanDto;
};

/** HU-E1-09: `owner` archives the space; nothing was recorded, so every balance is settled. */
const archive = async (owner: Parameters<typeof activatePlan>[0], spaceId: string) => {
  const archived = await call(archiveSpace, "POST", `/api/v1/spaces/${spaceId}/archive`, {
    user: owner,
    params: { spaceId },
  });
  expect(archived.status).toBe(204);
};

/** The plan's status and ETag as `user` reads them now: a refused activation must leave both as they were. */
const statusAndEtag = async (...args: Parameters<typeof getPlan>) => {
  const response = await getPlan(...args);
  expect(response.status).toBe(200);
  return [((await response.json()) as PlanDto).status, response.headers.get("etag")];
};

/** The members of a problem body, sorted: its whole public shape. */
const keysOf = async (response: Response) => Object.keys(await response.json()).sort();

describe("activating a plan (HU-E6-07)", () => {
  it("activates the valid reference plan and answers it with its new ETag", async () => {
    const { h, planId, plan } = await referencePlan();
    const response = await activatePlan(h.ana, h.spaceId, planId, plan.version);
    expect([response.status, response.headers.get("etag")]).toEqual([200, `"${plan.version + 1}"`]);
    const body = (await response.json()) as PlanDto;
    expect([body.status, body.version, body.lines.length]).toEqual(["ACTIVE", plan.version + 1, 4]);
    expect((await planOf(h.juan, h.spaceId, planId)).status).toBe("ACTIVE");
  });

  it("refuses a plan whose Free percentages sum to 99 % once Luis left, naming Free and nothing else (Review Focus 3)", async () => {
    const { h, planId, lineId } = await referencePlan();
    const luis = await joinHousehold(h, "Luis", "MEMBER");
    const free = lineId("Free");
    const split = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "57" },
        { memberId: luis.memberId, percent: "1" },
      ],
    };
    expect((await putAllocation(h.ana, h.spaceId, planId, free, split)).status).toBe(200);
    const left = await call(leaveSpace, "POST", `/api/v1/spaces/${h.spaceId}/leave`, {
      user: luis,
      params: { spaceId: h.spaceId },
    });
    expect(left.status).toBe(204);
    const before = await statusAndEtag(h.ana, h.spaceId, planId);
    const response = await activatePlan(h.ana, h.spaceId, planId);
    expect(response.status).toBe(422);
    // The public shape: the standard members plus lineIds, never the private reason or any other detail.
    expect(await keysOf(response.clone())).toEqual([
      "code",
      "lineIds",
      "requestId",
      "status",
      "title",
      "type",
    ]);
    expect(await response.json()).toMatchObject({ code: "InvalidAllocation", lineIds: [free] });
    expect(await statusAndEtag(h.ana, h.spaceId, planId)).toEqual(before);
    expect(before[0]).toBe("DRAFT");
  });

  it("keeps the reason of AllocateBudgetLine's InvalidAllocation private: no lineIds, no reason", async () => {
    const { h, planId, lineId } = await referencePlan();
    const notHundred = {
      rule: "PERCENT",
      members: [
        { memberId: h.ana.memberId, percent: "42" },
        { memberId: h.juan.memberId, percent: "57" },
      ],
    };
    const response = await putAllocation(h.ana, h.spaceId, planId, lineId("Free"), notHundred);
    expect(response.status).toBe(422);
    expect(await keysOf(response.clone())).toEqual(["code", "requestId", "status", "title", "type"]);
    expect(await response.json()).toMatchObject({ code: "InvalidAllocation" });
  });

  it("refuses a plan whose capacity was reduced below its lines: Juan at 2,000,000 COP", async () => {
    const { h, planId } = await referencePlan();
    await setCapacities(h.ana, h.spaceId, planId, [[h.juan.memberId, 2_000_000]]);
    const before = await statusAndEtag(h.ana, h.spaceId, planId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "PlanExceedsCapacity",
    ]);
    expect(await statusAndEtag(h.ana, h.spaceId, planId)).toEqual(before);
    expect(before[0]).toBe("DRAFT");
  });

  it("activates only a DRAFT plan, only for owners and admins, and honours If-Match", async () => {
    const { h, planId, plan } = await referencePlan();
    expect(await problemOf(await activatePlan(h.juan, h.spaceId, planId))).toEqual([403, "InsufficientRole"]);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId, plan.version + 5))).toEqual([
      412,
      "PreconditionFailed",
    ]);
    await activated(h.ana, h.spaceId, planId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([
      409,
      "InvalidPlanTransition",
    ]);
  });

  it("answers BudgetPlanNotFound for unknown and malformed plan ids, SpaceNotFound to a stranger, and SpaceArchived in an archived space", async () => {
    const { h, planId } = await referencePlan();
    const marta = await registerUser("Marta");
    expect(await problemOf(await activatePlan(marta, h.spaceId, planId))).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, "not-a-uuid"))).toEqual([
      404,
      "BudgetPlanNotFound",
    ]);
    expect(
      await problemOf(await activatePlan(h.ana, h.spaceId, "0190a0a0-0000-7000-8000-000000000000")),
    ).toEqual([404, "BudgetPlanNotFound"]);
    await archive(h.ana, h.spaceId);
    expect(await problemOf(await activatePlan(h.ana, h.spaceId, planId))).toEqual([409, "SpaceArchived"]);
    expect((await planOf(h.ana, h.spaceId, planId)).status).toBe("DRAFT");
  });
});

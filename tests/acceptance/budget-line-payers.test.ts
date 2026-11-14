import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PATCH as patchLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/[lineId]/route";
import { POST as postLineRoute } from "@/app/api/v1/spaces/[spaceId]/plans/[planId]/lines/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, problemOf, startTestApp, type TestUser } from "../support/app";
import { lineNamed, newPlan, plansPath, setCapacities, type PlanDto } from "../support/budgeting";
import { cop, household, joinHousehold } from "../support/ledger";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

/** D26 Background: Household (OWNER Ana, MEMBER Juan, VIEWER Sofi) with a DRAFT plan for 2026-11. */
const background = async () => {
  const h = await household();
  const sofi = await joinHousehold(h, "Sofi", "VIEWER");
  const { id: planId } = await newPlan(h.ana, h.spaceId, "2026-11");
  await setCapacities(h.ana, h.spaceId, planId, [
    [h.ana.memberId, 1_600_000],
    [h.juan.memberId, 2_400_000],
  ]);
  const post = (user: TestUser, body: unknown) =>
    call(postLineRoute, "POST", plansPath(h.spaceId, `/${planId}/lines`), {
      user,
      params: { spaceId: h.spaceId, planId },
      body,
    });
  const patch = (user: TestUser, lineId: string, body: unknown) =>
    call(patchLineRoute, "PATCH", plansPath(h.spaceId, `/${planId}/lines/${lineId}`), {
      user,
      params: { spaceId: h.spaceId, planId, lineId },
      body,
    });
  return { h, sofi, planId, post, patch };
};
const rent = { name: "Rent", plannedAmount: cop(1_200_000), funding: "SHARED_FUND" };

describe("plan line payers over HTTP (D26, #316)", () => {
  it("adds Rent paid by Ana every month and answers its payers and scope", async () => {
    const { h, post } = await background();
    const response = await post(h.ana, { ...rent, payerMemberIds: [h.ana.memberId] });
    expect(response.status).toBe(201);
    expect(lineNamed((await response.json()) as PlanDto, "Rent")).toMatchObject({
      payerMemberIds: [h.ana.memberId],
      payersScope: "EVERY_PERIOD",
      allocation: { rule: "PROPORTIONAL" },
    });
  });

  it("answers a line without payers with neither field, as before", async () => {
    const { h, post } = await background();
    const plan = (await (await post(h.ana, rent)).json()) as PlanDto;
    const line = lineNamed(plan, "Rent");
    expect(line).not.toHaveProperty("payerMemberIds");
    expect(line).not.toHaveProperty("payersScope");
  });

  it("lets Juan, a payer, change only the payers and scope; anything else is 403", async () => {
    const { h, post, patch } = await background();
    const plan = (await (
      await post(h.ana, { ...rent, payerMemberIds: [h.juan.memberId] })
    ).json()) as PlanDto;
    const lineId = lineNamed(plan, "Rent").id;
    const changed = await patch(h.juan, lineId, {
      payerMemberIds: [h.juan.memberId, h.ana.memberId],
      payersScope: "THIS_PERIOD",
    });
    expect(changed.status).toBe(200);
    expect(lineNamed((await changed.json()) as PlanDto, "Rent")).toMatchObject({
      payerMemberIds: [h.juan.memberId, h.ana.memberId],
      payersScope: "THIS_PERIOD",
    });
    expect(await problemOf(await patch(h.juan, lineId, { name: "Arriendo" }))).toEqual([
      403,
      "InsufficientRole",
    ]);
  });

  it("refuses a VIEWER as payer (422) and a VIEWER's change (403)", async () => {
    const { h, sofi, post, patch } = await background();
    expect(await problemOf(await post(h.ana, { ...rent, payerMemberIds: [sofi.memberId] }))).toEqual([
      422,
      "InvalidLinePayers",
    ]);
    const plan = (await (await post(h.ana, rent)).json()) as PlanDto;
    expect(
      await problemOf(await patch(sofi, lineNamed(plan, "Rent").id, { payersScope: "THIS_PERIOD" })),
    ).toEqual([403, "InsufficientRole"]);
  });

  it("refuses an unknown scope at the edge", async () => {
    const { h, post } = await background();
    expect(
      await problemOf(
        await post(h.ana, { ...rent, payerMemberIds: [h.ana.memberId], payersScope: "SOMETIMES" }),
      ),
    ).toEqual([422, "ValidationFailed"]);
  });
});

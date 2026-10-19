import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setContainerForTests, type Container } from "@/composition/container";
import { GET as lineTrendRoute } from "@/app/api/v1/spaces/[spaceId]/reports/trend/route";
import { call, problemOf, registerUser, startTestApp } from "../support/app";
import { addLine, lineNamed, newPlan, putCategories, setCapacities } from "../support/budgeting";
import { categoryWithKey, cop, joinHousehold } from "../support/ledger";
import { archiveHousehold } from "../support/recurrences";
import { getLineTrend, reportHousehold, spend, type LineTrendDto } from "../support/reporting";

let app: Container;
beforeAll(() => {
  app = startTestApp();
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

describe("line trend over HTTP (HU-E7-05)", () => {
  it("gives Home's change versus 2026-10, -50,000 COP (-3.70 %), and Pets, new in 2026-11, the status NEW", async () => {
    const r = await reportHousehold();
    const { h, category } = r;
    // 2026-10 has its own Home (not a copy): the trend follows it by name (ruling P38).
    const october = await newPlan(h.ana, h.spaceId, "2026-10");
    await setCapacities(h.ana, h.spaceId, october.id, [[h.ana.memberId, 1_600_000]]);
    const withHome = await addLine(h.ana, h.spaceId, october.id, { name: "Home", pesos: 1_470_000 });
    const mapped = await putCategories(h.ana, h.spaceId, october.id, lineNamed(withHome, "Home").id, [
      category.groceries,
    ]);
    expect(mapped.status).toBe(200);
    // Pets joins 2026-11 with capacity to spare.
    await setCapacities(h.ana, h.spaceId, r.planId, [
      [h.ana.memberId, 1_700_000],
      [h.juan.memberId, 2_400_000],
    ]);
    const withPets = await addLine(h.ana, h.spaceId, r.planId, { name: "Pets", pesos: 100_000 });
    const maintenance = await categoryWithKey(h.ana, "maintenance");
    expect(
      (await putCategories(h.ana, h.spaceId, r.planId, lineNamed(withPets, "Pets").id, [maintenance])).status,
    ).toBe(200);
    await spend(h.ana, category.groceries, 1_350_000, "2026-10-10");
    await spend(h.ana, category.groceries, 900_000, "2026-11-05");
    await spend(h.juan, category.utilities, 400_000, "2026-11-10");
    await spend(h.ana, maintenance, 80_000, "2026-11-11");
    const response = await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods: 2 });
    expect(response.status).toBe(200);
    const trend = (await response.json()) as LineTrendDto;
    expect(trend.periods.map((p) => p.label)).toEqual(["2026-10", "2026-11"]);
    expect(trend.plan).toEqual({ id: r.planId, status: "DRAFT" });
    expect(trend.lines.find((l) => l.name === "Home")?.points).toEqual([
      { period: "2026-10", spent: cop(1_350_000), change: null, changePercent: null, changeStatus: "NEW" },
      {
        period: "2026-11",
        spent: cop(1_300_000),
        change: cop(-50_000),
        changePercent: "-3.70",
        changeStatus: "DECREASED",
      },
    ]);
    expect(trend.lines.find((l) => l.name === "Pets")?.points).toEqual([
      { period: "2026-10", spent: null, change: null, changePercent: null, changeStatus: null },
      { period: "2026-11", spent: cop(80_000), change: null, changePercent: null, changeStatus: "NEW" },
    ]);
  });

  it("shows six periods by default and refuses windows outside 1 to 24 periods", async () => {
    const { h } = await reportHousehold();
    const response = await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11" });
    expect(((await response.json()) as LineTrendDto).periods.map((p) => p.label)).toEqual([
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
      "2026-11",
    ]);
    for (const periods of [0, 25, "six"]) {
      expect(
        await problemOf(await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods })),
      ).toEqual([422, "ValidationFailed"]);
    }
    expect(await problemOf(await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11 H2" }))).toEqual([
      422,
      "InvalidPeriodLabel",
    ]);
    const marta = await registerUser("Marta");
    expect(await problemOf(await getLineTrend(marta, h.spaceId, { endPeriod: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });

  it("takes the edges of the window (1 and 24) and refuses a fraction, a negative, an empty value and a missing end", async () => {
    const { h } = await reportHousehold();
    const one = (await (
      await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods: 1 })
    ).json()) as LineTrendDto;
    expect(one.periods.map((p) => p.label)).toEqual(["2026-11"]);
    const widest = (await (
      await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods: 24 })
    ).json()) as LineTrendDto;
    expect(widest.periods).toHaveLength(24);
    expect(widest.periods[0]?.label).toBe("2024-12");
    expect(widest.periods[23]?.label).toBe("2026-11");
    for (const periods of [1.5, -1, ""]) {
      expect(
        await problemOf(await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods })),
      ).toEqual([422, "ValidationFailed"]);
    }
    expect(await problemOf(await getLineTrend(h.ana, h.spaceId, { periods: 3 }))).toEqual([
      422,
      "ValidationFailed",
    ]);
  });

  it("lets VIEWER Sofi read it, answers 401 without a session and reads an archived space", async () => {
    const { h } = await reportHousehold();
    const sofi = await joinHousehold(h, "Sofi", "VIEWER");
    const viewed = await getLineTrend(sofi, h.spaceId, { endPeriod: "2026-11", periods: 2 });
    expect(viewed.status).toBe(200);
    expect(((await viewed.json()) as LineTrendDto).lines).toHaveLength(4);
    const anonymous = await call(
      lineTrendRoute,
      "GET",
      `/api/v1/spaces/${h.spaceId}/reports/trend?endPeriod=2026-11`,
      {
        params: { spaceId: h.spaceId },
      },
    );
    expect(await problemOf(anonymous)).toEqual([401, "Unauthenticated"]);
    await archiveHousehold(h);
    const archived = await getLineTrend(h.ana, h.spaceId, { endPeriod: "2026-11", periods: 2 });
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as LineTrendDto).lines).toHaveLength(4);
  });

  it("answers a stranger and an unknown space the same way, before looking at the window", async () => {
    const { h } = await reportHousehold();
    const marta = await registerUser("Marta");
    expect(
      await problemOf(await getLineTrend(marta, h.spaceId, { endPeriod: "2026-11", periods: 3 })),
    ).toEqual([404, "SpaceNotFound"]);
    expect(
      await problemOf(
        await getLineTrend(h.ana, "00000000-0000-4000-8000-000000000000", { endPeriod: "2026-11" }),
      ),
    ).toEqual([404, "SpaceNotFound"]);
    expect(await problemOf(await getLineTrend(h.ana, "not-a-uuid", { endPeriod: "2026-11" }))).toEqual([
      404,
      "SpaceNotFound",
    ]);
  });
});

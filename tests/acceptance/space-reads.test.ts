import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as listPeriods } from "@/app/api/v1/spaces/[spaceId]/periods/route";
import { GET as getSpace } from "@/app/api/v1/spaces/[spaceId]/route";
import { setContainerForTests, type Container } from "@/composition/container";
import { FixedClock } from "@/shared/kernel";
import { call, problemOf, registerUser, startTestApp, type TestUser } from "../support/app";

let app: Container;
beforeAll(() => {
  // With no `from`, the periods start at today: 2026-10-20 in Bogota, never the wall clock (AGENTS.md).
  app = startTestApp({ clock: new FixedClock(new Date("2026-10-20T17:00:00Z")) });
});
afterAll(async () => {
  setContainerForTests(undefined);
  await app.pool.end();
});

const periodsOf = (user: TestUser, spaceId: string, query = "") =>
  call(listPeriods, "GET", `/api/v1/spaces/${spaceId}/periods${query}`, { user, params: { spaceId } });
const labels = async (response: Response) =>
  ((await response.json()) as { items: { label: string }[] }).items.map((p) => p.label);

describe("reading a space and its periods (HU-E1-03, M1 review)", () => {
  it("hides another user's space, and a malformed id, from both reads", async () => {
    const ana = await registerUser("Ana");
    const juan = await registerUser("Juan");
    for (const spaceId of [ana.spaceId, "not-a-uuid"]) {
      const space = await call(getSpace, "GET", `/api/v1/spaces/${spaceId}`, {
        user: juan,
        params: { spaceId },
      });
      expect(await problemOf(space)).toEqual([404, "SpaceNotFound"]);
      expect(await problemOf(await periodsOf(juan, spaceId))).toEqual([404, "SpaceNotFound"]);
    }
  });

  it("lists six periods from today's by default", async () => {
    const ana = await registerUser("Ana");
    const response = await periodsOf(ana, ana.spaceId);
    expect(response.status).toBe(200);
    expect(await labels(response)).toEqual([
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
    ]);
  });

  it("takes a count from 1 to 24 and refuses one outside it", async () => {
    const ana = await registerUser("Ana");
    expect(await labels(await periodsOf(ana, ana.spaceId, "?count=1"))).toEqual(["2026-10"]);
    expect(await labels(await periodsOf(ana, ana.spaceId, "?from=2026-01-15&count=24"))).toHaveLength(24);
    for (const count of ["0", "25", "-1", "2.5", "many"]) {
      expect(await problemOf(await periodsOf(ana, ana.spaceId, `?count=${count}`)), count).toEqual([
        422,
        "ValidationFailed",
      ]);
    }
  });
});

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { moduleKeys } from "../reads";
import { planWrites } from "./writes";

const PLAN = moduleKeys.plan("sp-1", "p-1");
const write = (method: "PUT" | "POST", path: string) =>
  planWrites({ method, path, params: { spaceId: "sp-1", planId: "p-1" }, body: {} }, new QueryClient());

describe("the plan's writes (HU-E9-08, ruling P206)", () => {
  it("keeps the plan the API answered, with its new version, before the plan is read again", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(PLAN, { id: "p-1", version: 3, lines: [] });
    write("PUT", "/api/v1/spaces/{spaceId}/plans/{planId}/capacities")!.accepted(queryClient, {
      id: "p-1",
      version: 4,
      lines: [],
    });
    // A line added at once carries `If-Match: "4"`, not the version the save made stale.
    expect(queryClient.getQueryData(PLAN)).toEqual({ id: "p-1", version: 4, lines: [] });
    expect(queryClient.getQueryState(PLAN)?.isInvalidated).toBe(true);
  });

  it("keeps a new plan under its own id, and leaves the cache alone for an answer that is not a plan", () => {
    const queryClient = new QueryClient();
    write("POST", "/api/v1/spaces/{spaceId}/plans")!.accepted(queryClient, {
      id: "p-2",
      version: 1,
      lines: [],
    });
    expect(queryClient.getQueryData(moduleKeys.plan("sp-1", "p-2"))).toEqual({
      id: "p-2",
      version: 1,
      lines: [],
    });
    write("POST", "/api/v1/spaces/{spaceId}/plans/{planId}/activate")!.accepted(queryClient, undefined);
    expect(queryClient.getQueryData(PLAN)).toBeUndefined();
  });
});

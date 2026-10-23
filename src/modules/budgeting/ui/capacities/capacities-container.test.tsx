import { screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cop, meDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import { HOUSEHOLD_MEMBERS, householdDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { CapacitySuggestionDto } from "@/shared/ui/api/dto";

const served = vi.hoisted(() => ({ api: undefined as unknown, me: "u-ana", role: "OWNER" as string }));
vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: async () => meDto({ id: served.me }),
  getSpaces: async () => [householdDto({ role: served.role as "OWNER" | "MEMBER" })],
  serverApi: async () => served.api,
}));
const { CapacityContainer } = await import("./capacities-container");

const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const answered = (memberId: string): CapacitySuggestionDto => ({
  memberId,
  period: OCTOBER,
  suggested: cop(1_650_000),
});
const serve = (viewer: string, role: string, suggestion: CapacitySuggestionDto) => {
  served.me = viewer;
  served.role = role;
  const fake = fakeApi({
    "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(referencePlanDto()),
    "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
    "GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": () => jsonResponse(suggestion),
  });
  served.api = fake.api;
  return fake.requests;
};
const received = async () =>
  (await CapacityContainer({ spaceId: "sp-household", planId: "p-nov" })) as ReactElement<{
    suggestion: CapacitySuggestionDto | null;
  }>;

beforeEach(() => vi.clearAllMocks());

describe("the capacities container and the private suggestion (ruling P208, review focus 2)", () => {
  it("asks once, with the request's own api, and hands Ana her own suggestion", async () => {
    const requests = serve("u-ana", "OWNER", answered("m-ana"));
    const element = await received();
    expect(element.props.suggestion).toEqual(answered("m-ana"));
    const asked = requests.filter((request) => request.url.includes("capacity-suggestion"));
    expect(asked).toHaveLength(1);
    expect(new URL(asked[0]!.url).search).toBe("");
  });

  it("never hands the page a suggestion that names another member, so it is not in what the page receives", async () => {
    serve("u-juan", "MEMBER", answered("m-ana"));
    const element = await received();
    expect(element.props.suggestion).toBeNull();
    expect(JSON.stringify(element.props)).not.toContain("165000000");
    renderWithIntl(element);
    expect(screen.queryByText(/Sugerido/)).toBeNull();
    expect(document.body.innerHTML).not.toContain("1.650.000");
  });

  it("does not hand a manager the suggestion of a member other than themselves", async () => {
    serve("u-ana", "OWNER", answered("m-juan"));
    expect((await received()).props.suggestion).toBeNull();
  });

  it("shows the screen without a suggestion when the read fails", async () => {
    serve("u-ana", "OWNER", answered("m-ana"));
    served.api = fakeApi({
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(referencePlanDto()),
      "GET /api/v1/spaces/{spaceId}/members": () => jsonResponse({ items: HOUSEHOLD_MEMBERS }),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}/capacity-suggestion": () =>
        new Response("x", { status: 502 }),
    }).api;
    expect((await received()).props.suggestion).toBeNull();
  });
});

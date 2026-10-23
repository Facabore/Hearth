import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { householdDto } from "../../../../tests/support/ui/plan-dto";
import { spaceDto } from "../../../../tests/support/ui/dto";
import { PlanHomeContainer } from "./plan-home";

const spaces = vi.hoisted(() => ({ list: [] as unknown[] }));

vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({ notFound: vi.fn(), redirect: vi.fn() }));
vi.mock("@/shared/ui/api/server", () => ({ getSpaces: async () => spaces.list }));
vi.mock("./lines/lines-container", () => ({ LineDashboardContainer: () => <p>lines container</p> }));
vi.mock("./unified/unified-container", () => ({ UnifiedViewContainer: () => <p>unified container</p> }));

const show = async (spaceId: string) => render(await PlanHomeContainer({ spaceId, period: "2026-11" }));

describe("the Plan tab's own page (ruling P200)", () => {
  it("opens on My spending in the personal space and on Lines in a shared one", async () => {
    spaces.list = [spaceDto({ id: "sp-personal", name: "Personal", kind: "PERSONAL" }), householdDto()];
    const personal = await show("sp-personal");
    expect(screen.getByText("unified container")).toBeInTheDocument();
    expect(screen.queryByText("lines container")).not.toBeInTheDocument();
    personal.unmount();
    await show("sp-household");
    expect(screen.getByText("lines container")).toBeInTheDocument();
    expect(screen.queryByText("unified container")).not.toBeInTheDocument();
  });
});

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { fakeApi, jsonResponse, problemResponse } from "../../../../tests/support/ui/fake-api";
import { copiedPlanDto, referencePlanDto } from "../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import { takeDropped } from "./copy-notice";
import { PlanStartActions } from "./plan-start";

const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

const PLANS = "POST /api/v1/spaces/{spaceId}/plans";
/** Ruling P311: the copy names the period it starts from. */
const COPY = "Copiar el plan de octubre";

describe("create or copy a plan (HU-E9-10, HU-E9-08)", () => {
  it("creates the period's plan and opens the planner", async () => {
    const { api, requests } = fakeApi({ [PLANS]: () => jsonResponse(referencePlanDto(), 201) });
    const { container } = renderWithIntl(
      <PlanStartActions spaceId="sp-household" period="2026-11" previous="octubre" api={api} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Crear plan" }));
    expect(await requests[0]!.json()).toEqual({ period: "2026-11" });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov");
    expect(sessionStorage.length).toBe(0);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("copies the previous plan and keeps what it dropped for the planner, once", async () => {
    const { api, requests } = fakeApi({ [PLANS]: () => jsonResponse(copiedPlanDto(), 201) });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-12" previous="octubre" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: COPY }));
    expect(await requests[0]!.json()).toEqual({ period: "2026-12", copyFrom: "previous" });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-dec");
    expect(takeDropped("p-dec")).toEqual(copiedPlanDto().dropped);
    expect(takeDropped("p-dec")).toBeNull();
  });

  it("says why a copy is not possible and stays", async () => {
    const { api } = fakeApi({ [PLANS]: () => problemResponse(409, "NoPreviousPlan") });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2027-01" previous="octubre" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: COPY }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No hay un plan anterior para copiar.");
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: COPY })).toBeEnabled();
  });

  it("re-reads the dashboard when someone just created the plan, and says so", async () => {
    const { api } = fakeApi({ [PLANS]: () => problemResponse(409, "PlanAlreadyExists") });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous="octubre" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: "Crear plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya hay un plan para ese periodo.");
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("does not refresh the dashboard for any other refusal", async () => {
    const { api } = fakeApi({ [PLANS]: () => problemResponse(409, "NoPreviousPlan") });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous="octubre" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: COPY }));
    await screen.findByRole("alert");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("disables both actions while a request is pending, so a double click sends one request", async () => {
    let release: (response: Response) => void = () => {};
    const { api, requests } = fakeApi({
      [PLANS]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous="octubre" api={api} />);
    const create = screen.getByRole("button", { name: "Crear plan" });
    await userEvent.dblClick(create);
    expect(create).toBeDisabled();
    expect(screen.getByRole("button", { name: COPY })).toBeDisabled();
    expect(requests).toHaveLength(1);
    release(jsonResponse(referencePlanDto(), 201));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });

  it("ignores a second click that lands before the re-render that disables the buttons", async () => {
    let release: (response: Response) => void = () => {};
    const { api, requests } = fakeApi({
      [PLANS]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous="octubre" api={api} />);
    const create = screen.getByRole("button", { name: "Crear plan" });
    const copy = screen.getByRole("button", { name: COPY });
    // Both clicks run inside one batch: React has not re-rendered the disabled buttons between them.
    act(() => {
      create.click();
      copy.click();
    });
    release(jsonResponse(referencePlanDto(), 201));
    await vi.waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(requests).toHaveLength(1);
  });

  it("opens the planner of a copy even when the browser keeps no session storage", async () => {
    const { api } = fakeApi({ [PLANS]: () => jsonResponse(copiedPlanDto(), 201) });
    const blocked = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-12" previous="octubre" api={api} />);
    await userEvent.click(screen.getByRole("button", { name: COPY }));
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-dec");
    blocked.mockRestore();
  });

  it("speaks English when the person does", () => {
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous="October" />, {
      locale: "en",
    });
    expect(screen.getByRole("button", { name: "Create plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy the October plan" })).toBeInTheDocument();
    expect(
      screen.getByText("Same lines, amounts, rules and contributions; then you adjust what changed."),
    ).toBeInTheDocument();
  });
});

describe("Crear plan first, the copy only from a previous plan (ruling P311, #275)", () => {
  it("leads with Crear plan as the primary action, and offers the copy second, named by its period", () => {
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous="octubre" />);
    const [create, copy, ...rest] = screen.getAllByRole("button");
    expect(create).toHaveAccessibleName("Crear plan");
    expect(create).toHaveClass("bg-accent");
    expect(copy).toHaveAccessibleName(COPY);
    expect(copy).not.toHaveClass("bg-accent");
    expect(rest).toEqual([]);
    expect(
      screen.getByText("Mismos rubros, montos, reglas y aportes; después ajustas lo que cambió."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No hay un plan anterior para copiar/)).toBeNull();
  });

  it("offers no copy without a previous plan, and says when it will", () => {
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" previous={null} />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Crear plan"]);
    expect(
      screen.getByText(
        "No hay un plan anterior para copiar: cuando tengas uno, podrás empezar el mes siguiente desde él.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Mismos rubros/)).toBeNull();
  });

  it("says nothing of a copy while it is not known whether there is a previous plan", () => {
    renderWithIntl(<PlanStartActions spaceId="sp-household" period="2026-11" />);
    expect(screen.getAllByRole("button").map((button) => button.textContent)).toEqual(["Crear plan"]);
    expect(screen.queryByText(/No hay un plan anterior para copiar/)).toBeNull();
  });
});

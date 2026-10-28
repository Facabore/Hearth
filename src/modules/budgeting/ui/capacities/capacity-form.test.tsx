import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { cop, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { HOUSEHOLD_MEMBERS, householdDto, referencePlanDto } from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CapacitySuggestionDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { CapacityForm } from "./capacity-form";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

const PUT = "PUT /api/v1/spaces/{spaceId}/plans/{planId}/capacities";
const GET_PLAN = "GET /api/v1/spaces/{spaceId}/plans/{planId}";
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const suggestion = (memberId: string, pesos: number): CapacitySuggestionDto => ({
  memberId,
  period: OCTOBER,
  suggested: cop(pesos),
});
const show = (options: {
  viewer: string;
  space?: SpaceDto;
  plan?: BudgetPlanDto;
  suggestion?: CapacitySuggestionDto | null;
  api?: Api;
}) =>
  renderWithIntl(
    <CapacityForm
      space={options.space ?? householdDto()}
      plan={options.plan ?? referencePlanDto()}
      members={HOUSEHOLD_MEMBERS}
      viewerUserId={options.viewer}
      suggestion={options.suggestion ?? null}
      formats={BUILT_IN_FORMATS}
      api={options.api}
    />,
  );
const rowOf = (name: string) => screen.getByRole("group", { name });

describe("capacities (HU-E9-08)", () => {
  it("shows Ana her private suggestion, fills her field with it and saves", async () => {
    const { api, requests } = fakeApi({
      [PUT]: () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    const { container } = show({ viewer: "u-ana", suggestion: suggestion("m-ana", 1_650_000), api });
    const ana = rowOf("Ana (tú)");
    expect(normalized(ana.textContent)).toContain(
      "Sugerido $ 1.650.000: tus ingresos de octubre 2026 en Personal. Solo tú lo ves.",
    );
    await userEvent.click(within(ana).getByRole("button", { name: "Usar sugerencia" }));
    expect(screen.getByLabelText("Capacidad de Ana")).toHaveValue("1.650.000");
    expect(requests).toHaveLength(0);
    expect(within(rowOf("Juan")).queryByText(/Sugerido/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(requests[0]!.headers.get("if-match")).toBe('"7"');
    expect(await requests[0]!.json()).toEqual({
      capacities: [
        { memberId: "m-ana", amount: { amount: "165000000", currency: "COP" } },
        { memberId: "m-juan", amount: { amount: "240000000", currency: "COP" } },
      ],
    });
    expect(router.push).toHaveBeenCalledWith("/spaces/sp-household/plans/p-nov");
    expect(router.refresh).toHaveBeenCalled();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("never shows Juan Ana's suggestion, even when an answer names her (ruling P208)", () => {
    const member = householdDto({ role: "MEMBER" });
    const juan = show({ viewer: "u-juan", space: member, suggestion: suggestion("m-juan", 2_000_000) });
    expect(normalized(rowOf("Juan (tú)").textContent)).toContain("Sugerido $ 2.000.000");
    expect(within(rowOf("Ana")).queryByText(/Sugerido/)).toBeNull();
    juan.unmount();
    show({ viewer: "u-juan", space: member, suggestion: suggestion("m-ana", 1_650_000) });
    expect(screen.queryByText(/1\.650\.000/)).toBeNull();
    expect(screen.queryByText(/Sugerido/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Usar sugerencia" })).toBeNull();
  });

  it("shows no suggestion block when the answer has no amount", () => {
    show({ viewer: "u-ana", suggestion: { ...suggestion("m-ana", 0), suggested: null } });
    expect(screen.queryByText(/Sugerido/)).toBeNull();
  });

  it("lets a MEMBER change only their own capacity", async () => {
    const { api, requests } = fakeApi({
      [PUT]: () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    show({ viewer: "u-juan", space: householdDto({ role: "MEMBER" }), api });
    expect(screen.queryByLabelText("Capacidad de Ana")).toBeNull();
    expect(normalized(rowOf("Ana").textContent)).toContain("$ 1.600.000");
    await userEvent.clear(screen.getByLabelText("Capacidad de Juan"));
    await userEvent.type(screen.getByLabelText("Capacidad de Juan"), "2.500.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(await requests[0]!.json()).toEqual({
      capacities: [{ memberId: "m-juan", amount: { amount: "250000000", currency: "COP" } }],
    });
  });

  it("shows the amount's format, drops a letter and still saves the capacity (#164)", async () => {
    const { api, requests } = fakeApi({
      [PUT]: () => jsonResponse(referencePlanDto({ version: 8 })),
    });
    show({ viewer: "u-juan", space: householdDto({ role: "MEMBER" }), api });
    const field = screen.getByLabelText("Capacidad de Juan");
    await userEvent.clear(field);
    expect(field).toHaveAccessibleDescription("Ej: 1.250,50");
    await userEvent.type(field, "2x500000");
    expect(field).toHaveValue("2.500.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(await requests[0]!.json()).toEqual({
      capacities: [{ memberId: "m-juan", amount: { amount: "250000000", currency: "COP" } }],
    });
  });

  it("only reads for a VIEWER and for a CLOSED plan, whoever the viewer is", () => {
    const viewer = show({ viewer: "u-juan", space: householdDto({ role: "VIEWER" }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar capacidades" })).toBeNull();
    expect(normalized(rowOf("Juan (tú)").textContent)).toContain("$ 2.400.000");
    viewer.unmount();
    show({ viewer: "u-ana", plan: referencePlanDto({ status: "CLOSED" }) });
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar capacidades" })).toBeNull();
    expect(normalized(rowOf("Ana (tú)").textContent)).toContain("$ 1.600.000");
  });

  it("shows the stored total and shares until the save answers, never a sum of the fields (ruling P208)", async () => {
    show({ viewer: "u-ana" });
    const summary = () => normalized(screen.getByText("Total").closest("div")!.textContent);
    expect(summary()).toContain("$ 4.000.000");
    expect(summary()).toContain("Ana $ 1.600.000 · 40,00 %");
    expect(summary()).toContain("Juan $ 2.400.000 · 60,00 %");
    await userEvent.clear(screen.getByLabelText("Capacidad de Ana"));
    await userEvent.type(screen.getByLabelText("Capacidad de Ana"), "9.000.000");
    expect(summary()).toContain("$ 4.000.000");
    expect(summary()).not.toContain("11.400.000");
    expect(summary()).toContain("Ana $ 1.600.000 · 40,00 %");
    expect(summary()).toContain("Juan $ 2.400.000 · 60,00 %");
  });

  it("explains the zero rule and who may change what", () => {
    show({ viewer: "u-ana" });
    expect(screen.getByText("Quien no tiene capacidad cuenta como $ 0.")).toBeInTheDocument();
    expect(
      screen.getByText("Un Miembro solo cambia la suya; Propietario y Administrador, la de todos."),
    ).toBeInTheDocument();
  });

  it("has a way back to the planner and says the period (UI rules)", () => {
    show({ viewer: "u-ana" });
    expect(screen.getByRole("heading", { level: 1, name: "Capacidades" })).toBeInTheDocument();
    expect(screen.getByText("Lo que cada persona pone en noviembre 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov",
    );
  });

  it("shows a refused amount next to its member's field, and an unreadable one before any call", async () => {
    const { api, requests } = fakeApi({
      [PUT]: () =>
        problemResponse(422, "ValidationFailed", { errors: [{ path: "capacities.0.amount", message: "x" }] }),
    });
    show({ viewer: "u-ana", api });
    await userEvent.clear(screen.getByLabelText("Capacidad de Juan"));
    // Letters cannot be typed (issue #164); three decimals in COP still cannot be read.
    await userEvent.type(screen.getByLabelText("Capacidad de Juan"), "1,234");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(screen.getByLabelText("Capacidad de Juan")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Escribe un monto como 1.500.000.")).toBeInTheDocument();
    expect(requests).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText("Capacidad de Juan"));
    await userEvent.type(screen.getByLabelText("Capacidad de Juan"), "2.400.000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Capacidad de Ana")).toHaveAttribute("aria-invalid", "true"),
    );
    expect(screen.getByLabelText("Capacidad de Juan")).not.toHaveAttribute("aria-invalid");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a refusal that names no member above the button", async () => {
    const { api } = fakeApi({ [PUT]: () => problemResponse(422, "InvalidCapacity") });
    show({ viewer: "u-ana", api });
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "La capacidad de cada miembro debe ser cero o más, y cada miembro va una sola vez.",
    );
    expect(screen.getByLabelText("Capacidad de Ana")).not.toHaveAttribute("aria-invalid");
  });

  it("re-reads the plan after a 412, keeps the message and saves the next time with the new version (ruling P206)", async () => {
    const fresh = referencePlanDto({
      version: 9,
      capacities: [
        { memberId: "m-ana", amount: cop(1_700_000), share: "41.46" },
        { memberId: "m-juan", amount: cop(2_400_000), share: "58.54" },
      ],
    });
    const answers = [
      problemResponse(412, "PreconditionFailed"),
      jsonResponse(referencePlanDto({ version: 10 })),
    ];
    const { api, requests } = fakeApi({
      [PUT]: () => answers.shift()!,
      [GET_PLAN]: () => jsonResponse(fresh),
    });
    show({ viewer: "u-ana", api });
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Alguien cambió esto mientras lo editabas.");
    await waitFor(() => expect(screen.getByLabelText("Capacidad de Ana")).toHaveValue("1.700.000"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Guardar capacidades" }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    expect(
      requests.filter((request) => request.method === "PUT").map((r) => r.headers.get("if-match")),
    ).toEqual(['"7"', '"9"']);
  });

  it("sends one request for a double click on Save and disables it while it is pending", async () => {
    let release: (response: Response) => void = () => {};
    const { api, requests } = fakeApi({
      [PUT]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    show({ viewer: "u-ana", api });
    const save = screen.getByRole("button", { name: "Guardar capacidades" });
    await userEvent.dblClick(save);
    expect(save).toBeDisabled();
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1);
    release(jsonResponse(referencePlanDto({ version: 8 })));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });

  it("ignores a second Save that arrives before the button is re-rendered as disabled", async () => {
    let release: (response: Response) => void = () => {};
    const { api, requests } = fakeApi({
      [PUT]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    show({ viewer: "u-ana", api });
    const save = screen.getByRole("button", { name: "Guardar capacidades" });
    // Both calls run in one batch, before React can disable the button: only the ref stops the second one.
    const key = Object.keys(save).find((name) => name.startsWith("__reactProps$"))!;
    const { onClick } = (save as unknown as Record<string, { onClick: () => void }>)[key]!;
    await act(async () => {
      onClick();
      onClick();
    });
    expect(requests.filter((request) => request.method === "PUT")).toHaveLength(1);
    release(jsonResponse(referencePlanDto({ version: 8 })));
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
  });
});

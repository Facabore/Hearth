import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { categoryDto, cop, groupDto, normalized } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  copiedPlanDto,
  freeAt99,
  HOUSEHOLD_MEMBERS,
  householdDto,
  referencePlanDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { rememberDropped } from "../copy-notice";
import { Planner } from "./planner";

vi.mock("next/headers", () => ({}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

const ACTIVATE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/activate";
const CLOSE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/close";
const show = ({
  plan = referencePlanDto(),
  space = householdDto(),
  api,
  today = "2026-10-31",
  groups = [],
}: {
  plan?: BudgetPlanDto;
  space?: SpaceDto;
  api?: Api;
  today?: string;
  groups?: CategoryGroupDto[];
} = {}) =>
  renderWithIntl(
    <Planner
      space={space}
      plan={plan}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
      today={today}
      groups={groups}
      api={api}
    />,
  );

describe("planner (HU-E9-08)", () => {
  it("shows total capacity split 40,00 % / 60,00 %, nothing unallocated and Home at 36,75 % of capacity (@golden)", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Plan de noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
    const capacity = normalized(screen.getByRole("region", { name: "Capacidad total" }).textContent);
    expect(capacity).toContain("$ 4.000.000");
    expect(capacity).toContain("Sin asignar $ 0");
    expect(capacity).toContain("Ana $ 1.600.000 · 40,00 %");
    expect(capacity).toContain("Juan $ 2.400.000 · 60,00 %");
    const home = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
    expect(home).toContain("$ 1.470.000");
    expect(home).toContain("36,75 % de la capacidad");
    expect(home).toContain("Directo · Según capacidad · Reinicia");
    expect(
      within(screen.getByRole("listitem", { name: "Free" })).getByText("Todo lo demás"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar Home" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/lines/l-home",
    );
    expect(screen.getByRole("link", { name: "Agregar línea" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/lines/new",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("has a way back to the dashboard of the plan's period, and says the dates (UI rules)", () => {
    show();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plan?period=2026-11",
    );
    expect(normalized(screen.getByText(/^Household ·/).textContent)).toBe(
      "Household · 1/11/2026 – 30/11/2026",
    );
  });

  it("names Free when activation finds its allocation invalid, then activates and later closes", async () => {
    const activations = [
      problemResponse(422, "InvalidAllocation", { lineIds: ["l-free"] }),
      jsonResponse(referencePlanDto({ status: "ACTIVE", version: 8 })),
    ];
    const { api, requests } = fakeApi({
      [ACTIVATE]: () => activations.shift()!,
      [CLOSE]: () => jsonResponse(referencePlanDto({ status: "CLOSED", version: 9 })),
    });
    show({ plan: freeAt99(), api, today: "2026-12-01" });
    expect(
      within(screen.getByRole("listitem", { name: "Free" })).getByText("Asignación inválida"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El reparto de esta línea no cuadra.");
    expect(alert).toHaveTextContent("No se puede activar: revisa la asignación de Free.");
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cerrar plan" }));
    expect(await screen.findByText("Cerrado")).toBeInTheDocument();
    expect(screen.getByText("Plan cerrado: queda en solo lectura.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Agregar línea" })).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(requests.map((r) => r.headers.get("if-match"))).toEqual(['"7"', '"7"', '"8"']);
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps Close disabled until the period is over, and says from when", () => {
    show({ plan: referencePlanDto({ status: "ACTIVE" }), today: "2026-11-15" });
    expect(screen.getByRole("button", { name: "Cerrar plan" })).toBeDisabled();
    expect(
      screen.getByText("Se puede cerrar cuando termine el período, desde el 1/12/2026."),
    ).toBeInTheDocument();
  });

  it("says when someone else changed the plan, and shows the plan as it now is (ruling P206)", async () => {
    const fresh = referencePlanDto({ version: 9, lines: referencePlanDto().lines.slice(0, 3) });
    const { api } = fakeApi({
      [ACTIVATE]: () => problemResponse(412, "PreconditionFailed"),
      "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(fresh),
    });
    show({ api });
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Alguien cambió esto mientras lo editabas.");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Free" })).toBeNull());
  });

  it("disables Activate while the call is pending, so a double click activates once", async () => {
    let release: (response: Response) => void = () => undefined;
    const { api, requests } = fakeApi({
      [ACTIVATE]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    show({ api });
    const activate = screen.getByRole("button", { name: "Activar plan" });
    await userEvent.dblClick(activate);
    expect(activate).toBeDisabled();
    release(jsonResponse(referencePlanDto({ status: "ACTIVE", version: 8 })));
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("ignores a second click that lands before the re-render that disables the button (ruling P206)", async () => {
    let release: (response: Response) => void = () => undefined;
    const { api, requests } = fakeApi({
      [ACTIVATE]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    show({ api });
    const activate = screen.getByRole("button", { name: "Activar plan" });
    // Both clicks run inside one batch: React has not re-rendered the disabled button between them.
    act(() => {
      activate.click();
      activate.click();
    });
    release(jsonResponse(referencePlanDto({ status: "ACTIVE", version: 8 })));
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(requests).toHaveLength(1);
  });

  it("shows a VIEWER no edit control, and a MEMBER only the way to their own capacity (ruling P207)", () => {
    const viewer = show({ space: householdDto({ role: "VIEWER" }) });
    for (const name of ["Activar plan"]) expect(screen.queryByRole("button", { name })).toBeNull();
    for (const name of ["Agregar línea", "Editar capacidades", "Editar Home"])
      expect(screen.queryByRole("link", { name })).toBeNull();
    viewer.unmount();
    show({ space: householdDto({ role: "MEMBER" }) });
    expect(screen.getByRole("link", { name: "Editar capacidades" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/capacities",
    );
    expect(screen.queryByRole("link", { name: "Editar Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Activar plan" })).toBeNull();
  });

  it("shows what the copy left out under the header, once, named from the space's categories", async () => {
    const plan = copiedPlanDto();
    rememberDropped(plan.id, plan.dropped!);
    const archived = [
      groupDto({
        id: "g-home",
        categories: [
          categoryDto({ id: "c-utilities", name: "Utilities", archivedAt: "2026-11-20T12:00:00.000Z" }),
        ],
      }),
    ];
    const { container } = show({ plan, groups: archived });
    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent("Utilities, que alimentaba Home");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("shows no copy notice for a plan that was not just copied", () => {
    show();
    expect(screen.queryByText("Copiado del plan anterior")).toBeNull();
  });

  it("shows a rolling line's mode and what it carries in, or the plan it waits for (#143)", () => {
    const october = {
      planId: "p-oct",
      period: { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" },
    };
    const plan = referencePlanDto();
    const home = plan.lines.findIndex((line) => line.name === "Home");
    plan.lines[home] = {
      ...plan.lines[home]!,
      rolloverMode: "ROLLOVER",
      carryOver: cop(200_000),
      available: cop(1_670_000),
      carryOverFrom: { ...october, closed: true },
    };
    const free = plan.lines.findIndex((line) => line.name === "Free");
    plan.lines[free] = {
      ...plan.lines[free]!,
      rolloverMode: "ADJUSTED",
      carryOverFrom: { ...october, closed: false },
    };
    show({ plan });
    const homeText = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
    expect(homeText).toContain("Directo · Según capacidad · Acumula");
    expect(homeText).toContain("+$ 200.000 de octubre 2026");
    expect(normalized(screen.getByRole("listitem", { name: "Free" }).textContent)).toContain(
      "Se arrastra de octubre 2026 cuando ese plan se cierre.",
    );
    expect(normalized(screen.getByRole("listitem", { name: "Rent" }).textContent)).not.toMatch(
      /octubre|arrastra/,
    );
  });
});

describe("closing a plan whose source is still open (ruling P248)", () => {
  const refusing = () =>
    fakeApi({ [CLOSE]: () => problemResponse(409, "SourcePlanOpen", { sourcePeriod: "2026-10" }) });
  const closable = (createdFrom: string | null) =>
    referencePlanDto({ status: "ACTIVE", createdFrom, version: 8 });

  it("names the period to close first and links to its plan, then lets the person try again", async () => {
    const { api, requests } = refusing();
    show({ plan: closable("p-oct"), api, today: "2026-12-01" });
    await userEvent.click(screen.getByRole("button", { name: "Cerrar plan" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Primero cierra el plan de 2026-10: este plan arrastra saldo de ese mes.",
    );
    const source = within(alert).getByRole("link", { name: "Ir al plan de 2026-10" });
    expect(source).toHaveAttribute("href", "/spaces/sp-household/plans/p-oct");
    expect(screen.getByRole("button", { name: "Cerrar plan" })).toBeEnabled();
    expect(requests).toHaveLength(1);
  });

  it("still says it when the plan does not know where it came from, with no link to follow", async () => {
    show({ plan: closable(null), api: refusing().api, today: "2026-12-01" });
    await userEvent.click(screen.getByRole("button", { name: "Cerrar plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Primero cierra el plan de 2026-10");
    expect(screen.queryByRole("link", { name: /^Ir al plan/ })).toBeNull();
  });

  it("speaks English when the person does", async () => {
    renderWithIntl(
      <Planner
        space={householdDto()}
        plan={closable("p-oct")}
        members={HOUSEHOLD_MEMBERS}
        formats={BUILT_IN_FORMATS}
        today="2026-12-01"
        groups={[]}
        api={refusing().api}
      />,
      { locale: "en" },
    );
    await userEvent.click(screen.getByRole("button", { name: "Close plan" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Close the plan for 2026-10 first: this plan carries a balance from that month.",
    );
    expect(screen.getByRole("link", { name: "Go to the plan for 2026-10" })).toBeInTheDocument();
  });
});

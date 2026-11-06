import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { categoryDto, cop, groupDto, normalized, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import {
  copiedPlanDto,
  freeAt99,
  HOUSEHOLD_MEMBERS,
  householdDto,
  referencePlanDto,
  spaceMemberDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { Api } from "@/shared/ui/api/client";
import type { BudgetPlanDto, CategoryGroupDto, SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { rememberDropped } from "../copy-notice";
import { Planner } from "./planner";

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, notFound: vi.fn(), redirect: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

const ACTIVATE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/activate";
const CLOSE = "POST /api/v1/spaces/{spaceId}/plans/{planId}/close";
/** Boards 08 and 09 of Pantallas nuevas: the lifecycle button opens a confirmation, whose own button acts. */
const confirm = async (action: "Activar plan" | "Cerrar plan" | "Activate plan" | "Close plan") => {
  await userEvent.click(screen.getByRole("button", { name: action }));
  const sheet = await screen.findByRole("dialog");
  await userEvent.click(within(sheet).getByRole("button", { name: action }));
};
const show = ({
  plan = referencePlanDto(),
  space = householdDto(),
  api,
  today = "2026-10-31",
  groups = [],
  unbudgetedCategoryIds,
}: {
  plan?: BudgetPlanDto;
  space?: SpaceDto;
  api?: Api;
  today?: string;
  groups?: CategoryGroupDto[];
  unbudgetedCategoryIds?: readonly string[];
} = {}) =>
  renderWithIntl(
    <Planner
      space={space}
      plan={plan}
      members={HOUSEHOLD_MEMBERS}
      formats={BUILT_IN_FORMATS}
      today={today}
      groups={groups}
      unbudgetedCategoryIds={unbudgetedCategoryIds}
      api={api}
    />,
  );

describe("planner (HU-E9-08)", () => {
  it("shows total capacity split 40,00 % / 60,00 %, nothing unallocated and Home at 36,75 % of capacity (@golden)", async () => {
    const { container } = show();
    expect(screen.getByRole("heading", { level: 1, name: "Plan de noviembre 2026" })).toBeInTheDocument();
    expect(screen.getByText("Borrador")).toBeInTheDocument();
    const capacity = normalized(
      screen.getByRole("region", { name: "Lo que aportan entre todos" }).textContent,
    );
    expect(capacity).toContain("$ 4.000.000");
    expect(capacity).toContain("Por repartir $ 0");
    expect(capacity).toContain("Ana $ 1.600.000 · 40,00 %");
    expect(capacity).toContain("Juan $ 2.400.000 · 60,00 %");
    const home = normalized(screen.getByRole("listitem", { name: "Home" }).textContent);
    expect(home).toContain("$ 1.470.000");
    expect(home).toContain("36,75 % de lo aportado");
    expect(home).toContain("Cada uno paga · Según aportes · Empieza de cero");
    expect(
      within(screen.getByRole("listitem", { name: "Free" })).getByText("Todo lo demás"),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Editar Home" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/lines/l-home",
    );
    expect(screen.getByRole("link", { name: "Agregar rubro" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov/lines/new",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("draws the capacity as a card: the total, Por repartir beside its heading and a two-tone bar of the shares (board 01)", () => {
    show();
    const card = screen.getByRole("region", { name: "Lo que aportan entre todos" });
    expect(card).toHaveClass("rounded-2xl", "border", "bg-surface");
    const heading = within(card).getByRole("heading", { name: "Lo que aportan entre todos" });
    expect(normalized(heading.parentElement!.textContent)).toBe("Lo que aportan entre todosPor repartir $ 0");
    const bar = card.querySelector("[data-share-bar]")!;
    expect(bar).toHaveAttribute("aria-hidden", "true");
    const parts = [...bar.children] as HTMLElement[];
    expect(parts.map((part) => part.style.flexBasis)).toEqual(["40%", "60%"]);
    expect(parts[0]!.className).not.toBe(parts[1]!.className);
    // The shares sit on one line, each percentage in bold: the bar is never the only way to read them.
    const shares = within(card).getByText(/^Ana/).parentElement!;
    expect(normalized(shares.textContent)).toBe("Ana $ 1.600.000 · 40,00 %Juan $ 2.400.000 · 60,00 %");
    expect(within(shares).getByText("40,00 %").tagName).toBe("STRONG");
  });

  it("offers Editar aportes and Agregar rubro as text links, and makes each line row its own link (board 01)", () => {
    show();
    for (const name of ["Editar aportes", "Agregar rubro"]) {
      const link = screen.getByRole("link", { name });
      expect(link.className).not.toMatch(/\bborder\b/);
    }
    const home = screen.getByRole("listitem", { name: "Home" });
    const edit = within(home).getByRole("link", { name: "Editar Home" });
    // No pencil: the link's area covers the row, and its text is the line's name.
    expect(edit.querySelector("svg")).toBeNull();
    expect(edit).toHaveTextContent("Home");
    expect(edit.className).toContain("after:inset-0");
    // The amount and its share are the row's right column.
    const figures = home.lastElementChild as HTMLElement;
    expect(figures).toHaveClass("text-right");
    expect(normalized(figures.textContent)).toBe("$ 1.470.00036,75 % de lo aportado");
  });

  it("writes a percentage split with its ratio, and names the sum of one that does not hold (boards 01 and 02)", () => {
    show({ plan: freeAt99() });
    const free = within(screen.getByRole("listitem", { name: "Free" }));
    expect(normalized(free.getByText(/^Cada uno paga/).textContent)).toBe(
      "Cada uno paga · Porcentaje 42 / 57 · Empieza de cero",
    );
    expect(normalized(free.getByText(/^Asignación inválida/).textContent)).toBe(
      "Asignación inválida: suma 99,00 %",
    );
  });

  it("asks before activating, and Ahora no sends nothing (Pantallas nuevas 08)", async () => {
    const { api, requests } = fakeApi({});
    show({ api });
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Activar el plan de noviembre?" });
    expect(
      within(sheet)
        .getAllByRole("listitem")
        .map((item) => normalized(item.textContent)),
    ).toEqual([
      "«Según el plan» pasa a ser la división por defecto",
      "Los gastos de noviembre se cuentan contra los rubros",
      "Puedes seguir editándolo mientras esté activo",
    ]);
    const [notNow, activate] = within(sheet).getAllByRole("button").slice(-2);
    expect(notNow).toHaveTextContent("Ahora no");
    expect(activate).toHaveTextContent("Activar plan");
    await userEvent.click(notNow!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(requests).toHaveLength(0);
  });

  it("asks before closing, saying it stays read-only and the leftover moves on (Pantallas nuevas 09)", async () => {
    show({ plan: referencePlanDto({ status: "ACTIVE" }), today: "2026-12-01" });
    await userEvent.click(screen.getByRole("button", { name: "Cerrar plan" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Cerrar el plan de noviembre?" });
    expect(
      within(sheet)
        .getAllByRole("listitem")
        .map((item) => normalized(item.textContent)),
    ).toEqual([
      "Queda en solo lectura, igual que los gastos fechados en noviembre",
      "Lo que sobra se pasa según la regla de cada rubro",
    ]);
    expect(within(sheet).getByRole("button", { name: "Ahora no" })).toBeEnabled();
    expect(within(sheet).getByRole("button", { name: "Cerrar plan" })).toBeEnabled();
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
      within(screen.getByRole("listitem", { name: "Free" })).getByText(/^Asignación inválida/),
    ).toBeInTheDocument();
    await confirm("Activar plan");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("El reparto de este rubro no cuadra.");
    expect(alert).toHaveTextContent("No se puede activar: revisa la asignación de Free.");
    await confirm("Activar plan");
    expect(await screen.findByText("Activo")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    await confirm("Cerrar plan");
    expect(await screen.findByText("Cerrado")).toBeInTheDocument();
    // Board 03: the read-only note is a tinted box that names the period.
    const closed = screen.getByText(
      "Plan cerrado: queda en solo lectura, igual que los gastos fechados en noviembre.",
    );
    expect(closed).toHaveClass("rounded-xl", "bg-track");
    expect(screen.queryByRole("link", { name: /^Editar/ })).toBeNull();
    expect(screen.queryByRole("link", { name: "Agregar rubro" })).toBeNull();
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
    await confirm("Activar plan");
    expect(await screen.findByRole("alert")).toHaveTextContent("Alguien cambió esto mientras lo editabas.");
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Free" })).toBeNull());
  });

  it("disables Activate while the call is pending, so a double click activates once", async () => {
    let release: (response: Response) => void = () => undefined;
    const { api, requests } = fakeApi({
      [ACTIVATE]: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    show({ api });
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    const activate = within(await screen.findByRole("dialog")).getByRole("button", { name: "Activar plan" });
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
    await userEvent.click(screen.getByRole("button", { name: "Activar plan" }));
    const activate = within(await screen.findByRole("dialog")).getByRole("button", { name: "Activar plan" });
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
    for (const name of ["Agregar rubro", "Editar aportes", "Editar Home"])
      expect(screen.queryByRole("link", { name })).toBeNull();
    viewer.unmount();
    show({ space: householdDto({ role: "MEMBER" }) });
    expect(screen.getByRole("link", { name: "Editar aportes" })).toHaveAttribute(
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
    expect(homeText).toContain("Cada uno paga · Según aportes · Acumula");
    expect(homeText).toContain("+$ 200.000 de octubre 2026");
    expect(normalized(screen.getByRole("listitem", { name: "Free" }).textContent)).toContain(
      "Se arrastra de octubre 2026 cuando ese plan se cierre.",
    );
    expect(normalized(screen.getByRole("listitem", { name: "Rent" }).textContent)).not.toMatch(
      /octubre|arrastra/,
    );
  });
});

const PERIODS = "GET /api/v1/spaces/{spaceId}/periods";
const OCTOBER = { label: "2026-10", startDate: "2026-10-01", endDate: "2026-10-31" };
const DECEMBER = { label: "2026-12", startDate: "2026-12-01", endDate: "2026-12-31" };

describe("closing a plan whose source is still open (ruling P248)", () => {
  /** Issue #232: the refusal carries only the label; the planner reads the period before this plan's to name it. */
  const refusing = () =>
    fakeApi({
      [CLOSE]: () => problemResponse(409, "SourcePlanOpen", { sourcePeriod: "2026-10" }),
      [PERIODS]: (request) =>
        new URL(request.url).searchParams.get("from") === "2026-10-31"
          ? jsonResponse({ items: [OCTOBER] })
          : jsonResponse({ items: [] }),
    });
  const closable = (createdFrom: string | null) =>
    referencePlanDto({ status: "ACTIVE", createdFrom, version: 8 });

  it("names the period to close first and links to its plan, then lets the person try again", async () => {
    const { api, requests } = refusing();
    show({ plan: closable("p-oct"), api, today: "2026-12-01" });
    await confirm("Cerrar plan");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Primero cierra el plan de octubre 2026: este plan arrastra saldo de ese mes.",
    );
    expect(alert).not.toHaveTextContent("2026-10");
    const source = within(alert).getByRole("link", { name: "Ir al plan de octubre 2026" });
    expect(source).toHaveAttribute("href", "/spaces/sp-household/plans/p-oct");
    expect(screen.getByRole("button", { name: "Cerrar plan" })).toBeEnabled();
    expect(requests.map((request) => request.method)).toEqual(["POST", "GET"]);
  });

  it("still says it when the plan does not know where it came from, with no link to follow", async () => {
    show({ plan: closable(null), api: refusing().api, today: "2026-12-01" });
    await confirm("Cerrar plan");
    expect(await screen.findByRole("alert")).toHaveTextContent("Primero cierra el plan de octubre 2026");
    expect(screen.queryByRole("link", { name: /^Ir al plan/ })).toBeNull();
  });

  it("names a period that is not a calendar month by its dates, in the person's format (D23)", async () => {
    const { api } = fakeApi({
      [CLOSE]: () => problemResponse(409, "SourcePlanOpen", { sourcePeriod: "2026-10 H2" }),
      [PERIODS]: () =>
        jsonResponse({ items: [{ label: "2026-10 H2", startDate: "2026-10-16", endDate: "2026-10-31" }] }),
    });
    show({
      plan: closable("p-oct"),
      space: householdDto({ periodPolicy: { kind: "SEMI_MONTHLY", day1: 1, day2: 16 } }),
      api,
      today: "2026-12-01",
    });
    await confirm("Cerrar plan");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Primero cierra el plan de 16/10/2026 – 31/10/2026");
    expect(within(alert).getByRole("link", { name: "Ir al plan de 16/10/2026 – 31/10/2026" })).toBeVisible();
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
    await confirm("Close plan");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Close the plan for October 2026 first: this plan carries a balance from that month.",
    );
    expect(screen.getByRole("link", { name: "Go to the plan for October 2026" })).toBeInTheDocument();
  });
});

describe("activating a plan whose closed copy carries from it (issue #158)", () => {
  it("names the copy's period, read after this plan's period ends (issue #232)", async () => {
    const { api } = fakeApi({
      [ACTIVATE]: () => problemResponse(409, "CopyAlreadyClosed", { copyPeriod: "2026-12" }),
      [PERIODS]: (request) =>
        new URL(request.url).searchParams.get("from") === "2026-12-01"
          ? jsonResponse({ items: [DECEMBER] })
          : jsonResponse({ items: [] }),
    });
    show({ plan: referencePlanDto({ status: "DRAFT" }), api });
    await confirm("Activar plan");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "No puedes activar este plan: el plan de diciembre 2026, copiado de este, ya está cerrado",
    );
    expect(alert).not.toHaveTextContent("2026-12");
  });
});

describe("the planner of a personal space", () => {
  it("fills the bar with its one member and keeps the card's layout (board 01 in Personal)", () => {
    const plan = referencePlanDto({
      spaceId: "sp-personal",
      capacities: [{ memberId: "m-ana", amount: cop(3_200_000), share: "100.00" }],
      totalCapacity: cop(3_200_000),
      unallocated: cop(1_900_000),
    });
    renderWithIntl(
      <Planner
        space={spaceDto()}
        plan={plan}
        members={HOUSEHOLD_MEMBERS.slice(0, 1)}
        formats={BUILT_IN_FORMATS}
        today="2026-10-31"
        groups={[]}
      />,
    );
    const card = screen.getByRole("region", { name: "Lo que aportan entre todos" });
    expect(normalized(card.textContent)).toContain("Por repartir $ 1.900.000");
    const parts = [...card.querySelector("[data-share-bar]")!.children] as HTMLElement[];
    expect(parts.map((part) => part.style.flexBasis)).toEqual(["100%"]);
    expect(within(card).getByText("100,00 %").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "Agregar rubro" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/plans/p-nov/lines/new",
    );
  });
});

describe("a viewer in the capacity summary (#217)", () => {
  it("leaves out a viewer's zero capacity and keeps a viewer who holds one", () => {
    const plan = referencePlanDto();
    plan.capacities = [
      ...plan.capacities,
      { memberId: "m-sofi", amount: cop(0), share: "0.00" },
      { memberId: "m-tomas", amount: cop(100_000), share: "2.44" },
      { memberId: "m-lia", amount: cop(0), share: "0.00" },
    ];
    renderWithIntl(
      <Planner
        space={householdDto()}
        plan={plan}
        members={[
          ...HOUSEHOLD_MEMBERS,
          spaceMemberDto({ id: "m-sofi", userId: "u-sofi", displayName: "Sofi", role: "VIEWER" }),
          spaceMemberDto({ id: "m-tomas", userId: "u-tomas", displayName: "Tomás", role: "VIEWER" }),
          spaceMemberDto({ id: "m-lia", userId: "u-lia", displayName: "Lía", role: "MEMBER" }),
        ]}
        formats={BUILT_IN_FORMATS}
        today="2026-10-31"
        groups={[]}
      />,
    );
    const capacity = normalized(
      screen.getByRole("region", { name: "Lo que aportan entre todos" }).textContent,
    );
    expect(capacity).not.toContain("Sofi");
    expect(capacity).toContain("Tomás $ 100.000 · 2,44 %");
    expect(capacity).toContain("Lía $ 0 · 0,00 %");
    expect(capacity).toContain("Ana $ 1.600.000 · 40,00 %");
  });
});

/** #264 (H13): a line counts only the expenses of its categories, so the planner says when one counts nothing. */
describe("planner: lines with no category (#264)", () => {
  const NO_CATEGORIES = "Sin categorías: no cuenta ningún gasto";
  const PUT_CATEGORIES = "PUT /api/v1/spaces/{spaceId}/plans/{planId}/lines/{lineId}/categories";
  const health = groupDto({
    id: "g-health",
    name: "Health",
    key: "health",
    categories: [
      categoryDto({ id: "c-pharmacy", groupId: "g-health", name: "Pharmacy" }),
      categoryDto({ id: "c-medical", groupId: "g-health", name: "Medical" }),
    ],
  });

  it("marks a spending line with no category, never a savings line, the catch-all or a mapped line", () => {
    const plan = referencePlanDto();
    plan.lines = plan.lines.map((line) =>
      line.id === "l-rent" ? { ...line, categoryIds: ["c-medical"] } : line,
    );
    show({ plan, groups: [health] });
    expect(
      within(screen.getByRole("listitem", { name: "Home" })).getByText(NO_CATEGORIES),
    ).toBeInTheDocument();
    for (const name of ["Rent", "Savings", "Free"])
      expect(within(screen.getByRole("listitem", { name })).queryByText(NO_CATEGORIES)).toBeNull();
  });

  it("lists the period's spending no line counts and maps Pharmacy to Home with the plan's version", async () => {
    const plan = referencePlanDto({ lines: referencePlanDto().lines.filter((line) => !line.isCatchAll) });
    const mapped = { ...plan, version: 8 };
    const { api, requests } = fakeApi({ [PUT_CATEGORIES]: () => jsonResponse(mapped) });
    show({ plan, api, groups: [health], unbudgetedCategoryIds: ["c-pharmacy"] });
    const orphans = screen.getByRole("region", { name: "Gastos sin rubro" });
    expect(orphans).toHaveTextContent("Estos gastos de noviembre no cuentan en ningún rubro.");
    await userEvent.click(within(orphans).getByRole("button", { name: "Asignar Pharmacy a un rubro" }));
    const sheet = await screen.findByRole("dialog", { name: "Asignar Pharmacy a un rubro" });
    // A savings line takes no categories (ruling P212), so it is not offered.
    expect(within(sheet).queryByRole("radio", { name: /Savings/ })).toBeNull();
    await userEvent.click(within(sheet).getByRole("radio", { name: /Home/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Asignar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const put = requests.find((request) => request.method === "PUT")!;
    expect(new URL(put.url).pathname).toBe("/api/v1/spaces/sp-household/plans/p-nov/lines/l-home/categories");
    expect(put.headers.get("if-match")).toBe('"7"');
    expect(await put.json()).toEqual({ categoryIds: ["c-pharmacy"] });
    expect(screen.queryByRole("region", { name: "Gastos sin rubro" })).toBeNull();
    expect(router.refresh).toHaveBeenCalled();
  });

  it("keeps a line's own categories when it maps one more", async () => {
    const plan = referencePlanDto({ lines: referencePlanDto().lines.filter((line) => !line.isCatchAll) });
    plan.lines = plan.lines.map((line) =>
      line.id === "l-home" ? { ...line, categoryIds: ["c-medical"] } : line,
    );
    const { api, requests } = fakeApi({ [PUT_CATEGORIES]: () => jsonResponse({ ...plan, version: 8 }) });
    show({ plan, api, groups: [health], unbudgetedCategoryIds: ["c-pharmacy"] });
    await userEvent.click(screen.getByRole("button", { name: "Asignar Pharmacy a un rubro" }));
    const sheet = await screen.findByRole("dialog", { name: "Asignar Pharmacy a un rubro" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /Home/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Asignar" }));
    await waitFor(() => expect(requests.some((request) => request.method === "PUT")).toBe(true));
    expect(await requests.find((request) => request.method === "PUT")!.json()).toEqual({
      categoryIds: ["c-medical", "c-pharmacy"],
    });
  });

  it("says why a refused mapping failed and keeps the sheet open", async () => {
    const plan = referencePlanDto({ lines: referencePlanDto().lines.filter((line) => !line.isCatchAll) });
    // Someone mapped it to another line meanwhile.
    const { api } = fakeApi({ [PUT_CATEGORIES]: () => problemResponse(422, "CategoryAlreadyMapped") });
    show({ plan, api, groups: [health], unbudgetedCategoryIds: ["c-pharmacy"] });
    await userEvent.click(screen.getByRole("button", { name: "Asignar Pharmacy a un rubro" }));
    const sheet = await screen.findByRole("dialog", { name: "Asignar Pharmacy a un rubro" });
    await userEvent.click(within(sheet).getByRole("radio", { name: /Home/ }));
    await userEvent.click(within(sheet).getByRole("button", { name: "Asignar" }));
    expect(await within(sheet).findByRole("alert")).toHaveTextContent(
      "Esa categoría ya está en otro rubro del plan.",
    );
    expect(screen.getByRole("dialog", { name: "Asignar Pharmacy a un rubro" })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("offers no assignment to a member who cannot manage the plan, nor in a closed plan", () => {
    const plan = referencePlanDto({ lines: referencePlanDto().lines.filter((line) => !line.isCatchAll) });
    const { unmount } = show({
      plan,
      space: householdDto({ role: "MEMBER" }),
      groups: [health],
      unbudgetedCategoryIds: ["c-pharmacy"],
    });
    expect(screen.queryByRole("region", { name: "Gastos sin rubro" })).toBeNull();
    unmount();
    show({ plan: { ...plan, status: "CLOSED" }, groups: [health], unbudgetedCategoryIds: ["c-pharmacy"] });
    expect(screen.queryByRole("region", { name: "Gastos sin rubro" })).toBeNull();
  });

  it("speaks English too", async () => {
    const plan = referencePlanDto({ lines: referencePlanDto().lines.filter((line) => !line.isCatchAll) });
    renderWithIntl(
      <Planner
        space={householdDto()}
        plan={plan}
        members={HOUSEHOLD_MEMBERS}
        formats={BUILT_IN_FORMATS}
        today="2026-10-31"
        groups={[health]}
        unbudgetedCategoryIds={["c-pharmacy"]}
      />,
      { locale: "en" },
    );
    expect(
      within(screen.getByRole("listitem", { name: "Home" })).getByText("No categories: it counts no expense"),
    ).toBeInTheDocument();
    const orphans = screen.getByRole("region", { name: "Spending with no line" });
    expect(orphans).toHaveTextContent("This spending in November counts in no line.");
    expect(within(orphans).getByRole("button", { name: "Assign Pharmacy to a line" })).toBeInTheDocument();
  });
});

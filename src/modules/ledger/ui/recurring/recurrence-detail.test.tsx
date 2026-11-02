import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Api } from "@/shared/ui/api/client";
import type { SpaceDto } from "@/shared/ui/api/dto";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  categoryDto,
  groupDto,
  householdSpace,
  normalized,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { recurrenceDto } from "../../../../../tests/support/ui/recurrence-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { RecurrenceDto } from "./recurrence-request";
import { RecurrenceDetail } from "./recurrence-detail";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const groups = [groupDto({ id: "g-home", categories: [categoryDto({ id: "c-rent", name: "Arriendo" })] })];
const ONE = "/api/v1/spaces/{spaceId}/recurrences/{recurrenceId}";

const detail = (recurrence: RecurrenceDto = recurrenceDto(), space: SpaceDto = spaceDto()) => {
  const { api, requests } = fakeApi({
    [`POST ${ONE}/pause`]: () => jsonResponse({ ...recurrence, status: "PAUSED" }),
    [`POST ${ONE}/resume`]: () => jsonResponse({ ...recurrence, status: "ACTIVE" }),
    [`POST ${ONE}/end`]: () => jsonResponse({ ...recurrence, status: "ENDED" }),
    [`POST ${ONE}/extend`]: () => jsonResponse({ ...recurrence, status: "ACTIVE" }),
    [`PATCH ${ONE}`]: () => jsonResponse(recurrence),
  });
  const view = renderWithIntl(
    <ToastProvider>
      <RecurrenceDetail
        space={space}
        recurrence={recurrence}
        upcoming={recurrence.status === "ACTIVE" ? ["2026-12-01", "2027-01-01", "2027-02-01"] : []}
        groups={groups}
        accountNames={{ "a-bank": "Bancolombia" }}
        memberNames={{ "m-ana": "Ana" }}
        formats={BUILT_IN_FORMATS}
        today="2026-11-20"
        api={api as Api}
      />
    </ToastProvider>,
  );
  const calls = (method: string) =>
    requests.filter((r) => r.method === method).map((r) => new URL(r.url).pathname);
  return { ...view, requests, calls };
};

describe("a recurrence's detail (HU-E9-09, P270)", () => {
  it("shows the amount, schedule, accounts and the next dates the API answers", async () => {
    const { container } = detail();
    expect(screen.getByRole("heading", { level: 1, name: "Arriendo" })).toBeInTheDocument();
    const next = screen.getByRole("region", { name: "Próximas fechas" });
    expect(
      within(next)
        .getAllByRole("listitem")
        .map((item) => normalized(item.textContent)),
    ).toEqual(["1/12/2026−$ 1.200.000", "1/1/2027−$ 1.200.000", "1/2/2027−$ 1.200.000"]);
    expect(normalized(document.body.textContent)).toContain("Sale deBancolombia");
    expect(normalized(document.body.textContent)).toContain("Cada mes, el día 1");
    expect(screen.getByRole("link", { name: "Editar Arriendo" })).toHaveAttribute(
      "href",
      "/spaces/sp-personal/recurrences/r-rent/edit",
    );
    expect(await axeViolations(container)).toEqual([]);
  });

  it("pauses an active recurrence through its endpoint", async () => {
    const { calls } = detail();
    await userEvent.click(screen.getByRole("button", { name: "Pausar" }));
    await waitFor(() =>
      expect(calls("POST")).toEqual(["/api/v1/spaces/sp-personal/recurrences/r-rent/pause"]),
    );
    expect(router.refresh).toHaveBeenCalled();
  });

  it("offers Reanudar in their place while paused, and resumes through its endpoint", async () => {
    const { calls } = detail(recurrenceDto({ status: "PAUSED", nextOccurrence: null }));
    expect(screen.queryByRole("button", { name: "Pausar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Extender" })).toBeNull();
    expect(screen.getByText("En pausa: no se registra nada hasta que lo reanudes.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reanudar" }));
    await waitFor(() =>
      expect(calls("POST")).toEqual(["/api/v1/spaces/sp-personal/recurrences/r-rent/resume"]),
    );
  });

  it("ends one only after its confirmation", async () => {
    const { calls } = detail();
    await userEvent.click(screen.getByRole("button", { name: "Terminar" }));
    const sheet = await screen.findByRole("dialog", { name: "¿Terminar Arriendo?" });
    expect(calls("POST")).toEqual([]);
    await userEvent.click(within(sheet).getByRole("button", { name: "Terminar" }));
    await waitFor(() => expect(calls("POST")).toEqual(["/api/v1/spaces/sp-personal/recurrences/r-rent/end"]));
  });

  it("extends an ended one through its endpoint, with no end date", async () => {
    const { requests } = detail(
      recurrenceDto({ status: "ENDED", endDate: "2026-10-15", nextOccurrence: null }),
    );
    expect(screen.queryByRole("link", { name: "Editar Arriendo" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Extender" }));
    const sheet = await screen.findByRole("dialog", { name: "Extender Arriendo" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Sin fecha final" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(new URL(requests[0]!.url).pathname).toBe("/api/v1/spaces/sp-personal/recurrences/r-rent/extend");
    expect(await requests[0]!.clone().json()).toEqual({ endDate: null });
  });

  it("extends an active one by moving its end date (PATCH), since only an ended one takes the extend endpoint", async () => {
    const { requests } = detail(recurrenceDto({ endDate: "2027-11-30" }));
    await userEvent.click(screen.getByRole("button", { name: "Extender" }));
    const sheet = await screen.findByRole("dialog", { name: "Extender Arriendo" });
    await userEvent.click(within(sheet).getByRole("button", { name: "Mes siguiente" }));
    await userEvent.click(within(sheet).getByRole("button", { name: "31/12/2027" }));
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]!.method).toBe("PATCH");
    expect(await requests[0]!.clone().json()).toEqual({ endDate: "2027-12-31" });
  });

  it("shows the API's refusal in place", async () => {
    const { api } = fakeApi({
      [`POST ${ONE}/pause`]: () => problemResponse(409, "InvalidRecurrenceTransition"),
    });
    renderWithIntl(
      <RecurrenceDetail
        space={spaceDto()}
        recurrence={recurrenceDto()}
        upcoming={[]}
        groups={groups}
        accountNames={{}}
        memberNames={{}}
        formats={BUILT_IN_FORMATS}
        today="2026-11-20"
        api={api as Api}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Pausar" }));
    expect(
      await screen.findByText("Este movimiento recurrente no puede pasar a ese estado ahora."),
    ).toBeInTheDocument();
  });

  it("shows a viewer no pause, extend, end or edit control (S6)", async () => {
    const { container } = detail(recurrenceDto(), householdSpace({ role: "VIEWER" }));
    for (const name of ["Pausar", "Extender", "Terminar", "Reanudar"])
      expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByRole("link", { name: "Editar Arriendo" })).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
  });
});

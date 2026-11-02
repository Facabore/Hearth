import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import type { Api } from "@/shared/ui/api/client";
import { BUILT_IN_FORMATS } from "@/shared/ui/format/formatters";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import {
  accountDto,
  categoryDto,
  groupDto,
  householdSpace,
  memberDto,
  normalized,
  spaceDto,
} from "../../../../../tests/support/ui/dto";
import {
  fakeApi,
  jsonResponse,
  problemResponse,
  type FakeHandler,
} from "../../../../../tests/support/ui/fake-api";
import { recurrenceDto } from "../../../../../tests/support/ui/recurrence-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import type { SharedExpenseContext } from "../split/shared-context";
import { RecurrenceForm, type RecurrenceFormProps } from "./recurrence-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

const groups = [
  groupDto({ id: "g-home", name: "Hogar", categories: [categoryDto({ id: "c-rent", name: "Arriendo" })] }),
  groupDto({
    id: "g-income",
    name: "Ingresos",
    categories: [categoryDto({ id: "c-salary", name: "Salario" })],
  }),
];
const accounts = [
  accountDto({ id: "a-bank", name: "Bancolombia" }),
  accountDto({ id: "a-nequi", name: "Nequi", type: "WALLET" }),
];
const fund = accountDto({ id: "a-fund", name: "Fondo Hogar", type: "SHARED_FUND", ownerUserId: null });
const shared: SharedExpenseContext = {
  members: [memberDto(), memberDto({ id: "m-juan", userId: "u-juan", displayName: "Juan", role: "MEMBER" })],
  meMemberId: "m-ana",
  myAccounts: accounts,
  funds: [fund],
};

const previewOf =
  (dates: string[]): FakeHandler =>
  () =>
    jsonResponse({ dates });

const form = (routes: Record<string, FakeHandler>, extra: Partial<RecurrenceFormProps> = {}) => {
  const { api, requests } = fakeApi({
    "POST /api/v1/spaces/{spaceId}/recurrences/preview": previewOf([
      "2026-12-01",
      "2027-01-01",
      "2027-02-01",
    ]),
    "GET /api/v1/spaces/{spaceId}/default-split": () => problemResponse(404, "PlanNotFound"),
    ...routes,
  });
  const ui: ReactElement = (
    <ToastProvider>
      <RecurrenceForm
        space={spaceDto()}
        accounts={accounts}
        groups={groups}
        formats={BUILT_IN_FORMATS}
        today="2026-12-01"
        meMemberId="m-ana"
        api={api as Api}
        {...extra}
      />
    </ToastProvider>
  );
  return { ...renderWithIntl(ui), requests };
};

const bodies = async (requests: Request[], method: string, path: RegExp) =>
  Promise.all(
    requests
      .filter((r) => r.method === method && path.test(new URL(r.url).pathname))
      .map((r) => r.clone().json() as Promise<Record<string, unknown>>),
  );

const chooseRent = async () => {
  await userEvent.click(screen.getByRole("button", { name: /Categoría/ }));
  // A category without subcategories is chosen with one tap.
  await userEvent.click(screen.getByRole("radio", { name: "Arriendo" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
};

describe("the recurrence form (HU-E9-09, P270)", () => {
  it("shows the next dates the API previews, never its own date math (S3)", async () => {
    const { requests } = form(
      {
        "POST /api/v1/spaces/{spaceId}/recurrences/preview": previewOf([
          "2027-01-31",
          "2027-02-28",
          "2027-03-31",
        ]),
      },
      { today: "2027-01-01" },
    );
    const up = screen.getByRole("button", { name: "El día: un día después" });
    for (let i = 0; i < 30; i += 1) await userEvent.click(up);
    expect(within(screen.getByRole("group", { name: "El día" })).getByText("31")).toBeInTheDocument();
    expect(screen.getByText("Si el mes es más corto, se usa su último día.")).toBeInTheDocument();
    await waitFor(() =>
      expect(normalized(screen.getByTestId("recurrence-preview").textContent)).toBe(
        "Próximas fechas: 31/1/2027 · 28/2/2027 · 31/3/2027",
      ),
    );
    const sent = await bodies(requests, "POST", /\/recurrences\/preview$/);
    expect(sent.at(-1)).toEqual({
      schedule: { kind: "MONTHLY", day: 31 },
      startDate: "2027-01-01",
      count: 3,
    });
  });

  it("defines Arriendo MONTHLY(1) AUTO from 2026-12-01 with an idempotency key, then lands on the list (S2)", async () => {
    const { requests } = form({
      "POST /api/v1/spaces/{spaceId}/recurrences": () => jsonResponse(recurrenceDto(), 201),
    });
    await userEvent.type(screen.getByLabelText("Monto"), "1200000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Arriendo");
    await chooseRent();
    await userEvent.click(screen.getByRole("button", { name: /Cuenta/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /Bancolombia/ }));
    expect(screen.getByRole("radio", { name: /Automático/ })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("button", { name: "Guardar recurrente" }));

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/recurrences"));
    const define = requests.find(
      (r) => r.method === "POST" && /\/recurrences$/.test(new URL(r.url).pathname),
    )!;
    expect(define.headers.get("idempotency-key")).toMatch(/.+/);
    expect(await define.clone().json()).toEqual({
      description: "Arriendo",
      amount: { amount: "120000000", currency: "COP" },
      template: { type: "EXPENSE", categoryId: "c-rent", payer: { memberId: "m-ana", accountId: "a-bank" } },
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      startDate: "2026-12-01",
    });
    await waitFor(() =>
      expect(document.querySelector('[data-toast="status"]')).toHaveTextContent("Recurrente guardado"),
    );
  });

  it("asks twice a month for two days, and a mode that waits for the real amount", async () => {
    const { requests } = form({
      "POST /api/v1/spaces/{spaceId}/recurrences": () => jsonResponse(recurrenceDto(), 201),
    });
    await userEvent.click(screen.getByRole("radio", { name: "Dos veces al mes" }));
    expect(screen.getByRole("group", { name: "Primer día" })).toHaveTextContent("15");
    expect(screen.getByRole("group", { name: "Segundo día" })).toHaveTextContent("30");
    await userEvent.click(screen.getByRole("radio", { name: /Para confirmar/ }));
    expect(
      screen.getByText("En cada fecha te pedimos el monto real antes de registrarlo."),
    ).toBeInTheDocument();
    await waitFor(async () =>
      expect((await bodies(requests, "POST", /\/preview$/)).at(-1)).toMatchObject({
        schedule: { kind: "SEMI_MONTHLY", day1: 15, day2: 30 },
      }),
    );
  });

  it("shows the API's problem with the dates under them", async () => {
    form({
      "POST /api/v1/spaces/{spaceId}/recurrences/preview": () => problemResponse(422, "InvalidRecurrence"),
    });
    expect(
      await screen.findByText(
        "Revisa la programación: la fecha final no puede ser antes del inicio y debe quedar al menos una fecha.",
      ),
    ).toBeInTheDocument();
  });

  it("in a shared space names who pays and folds the split under Más opciones, as the record form does (S7)", async () => {
    const { requests, container } = form(
      { "POST /api/v1/spaces/{spaceId}/recurrences": () => jsonResponse(recurrenceDto(), 201) },
      { space: householdSpace({ name: "Hogar" }), shared, accounts: [fund] },
    );
    expect(screen.getByRole("radio", { name: "Aporte al fondo" })).toBeInTheDocument();
    const more = screen.getByRole("button", { name: "Más opciones" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(screen.getByRole("button", { name: /División/ })).toBeVisible();
    await userEvent.type(screen.getByLabelText("Monto"), "350000");
    await userEvent.type(screen.getByLabelText("Descripción"), "Administración");
    await chooseRent();
    await userEvent.click(screen.getByRole("button", { name: "Guardar recurrente" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    const [define] = await bodies(requests, "POST", /\/recurrences$/);
    expect(define!.template).toEqual({
      type: "EXPENSE",
      categoryId: "c-rent",
      payer: { memberId: "m-ana", accountId: "a-bank" },
    });
    expect(await axeViolations(container)).toEqual([]);
  });

  it("edits a recurrence through PATCH: what an edit may change, and back to its detail", async () => {
    const { requests } = form(
      {
        "PATCH /api/v1/spaces/{spaceId}/recurrences/{recurrenceId}": () => jsonResponse(recurrenceDto()),
      },
      { edit: recurrenceDto({ endDate: "2027-11-30" }) },
    );
    expect(screen.getByRole("heading", { level: 1, name: "Editar recurrente" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Gasto" })).toBeNull();
    const amount = screen.getByLabelText("Monto");
    await userEvent.clear(amount);
    await userEvent.type(amount, "1300000");
    await userEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith("/spaces/sp-personal/recurrences/r-rent"),
    );
    const [patch] = await bodies(requests, "PATCH", /\/recurrences\/r-rent$/);
    expect(patch).toEqual({
      description: "Arriendo",
      amount: { amount: "130000000", currency: "COP" },
      categoryId: "c-rent",
      schedule: { kind: "MONTHLY", day: 1 },
      mode: "AUTO",
      endDate: "2027-11-30",
    });
  });

  it("passes axe with its dates sheet open", async () => {
    const { container } = form({});
    await userEvent.click(screen.getByRole("button", { name: /Termina \(opcional\)/ }));
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("button", { name: "Sin fecha final" })).toBeInTheDocument();
    expect(await axeViolations(container)).toEqual([]);
  });
});

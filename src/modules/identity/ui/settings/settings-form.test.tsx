import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { meDto, normalized, patchedMe } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { SettingsForm } from "./settings-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

/** U8 (#224): each summary row opens its own sheet. */
const open = async (row: RegExp) => {
  await userEvent.click(screen.getByRole("button", { name: row }));
  return screen.findByRole("dialog");
};
const FORMATS = /^Números y fechas/;

describe("settings: three summary rows (U8, issue #224)", () => {
  it("shows Apariencia e idioma first, then Números y fechas and Zona horaria, each with its current values", async () => {
    const { container } = renderWithIntl(
      <SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={fakeApi({}).api} />,
    );
    expect(screen.queryByRole("radio")).toBeNull();
    const rows = screen.getAllByRole("button", {
      name: /^(Apariencia e idioma|Números y fechas|Zona horaria)/,
    });
    expect(rows.map((row) => normalized(row.textContent))).toEqual([
      "Apariencia e idiomaSistema · Español",
      "Números y fechas1.234.567,89 · 16/10/2026 · 14:30 · Semana desde el lunes",
      "Zona horariaBogota (GMT-5)",
    ]);
    expect(await axeViolations(container)).toEqual([]);
  });

  it("writes the row's figures with the same sample as the sheet's preview, and updates both on a choice", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/me": () => jsonResponse(patchedMe({ numberFormat: "COMMA_DOT" })),
    });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    const sheet = await open(FORMATS);
    expect(sheet).toHaveAccessibleName("Números y fechas");
    const preview = within(sheet).getByRole("status", { name: "Así se verá" });
    const row = () => normalized(screen.getByRole("button", { name: FORMATS, hidden: true }).textContent);
    expect(row()).toContain(normalized(preview.textContent).replace("Así se verá", ""));
    await userEvent.click(within(sheet).getByRole("radio", { name: "1,234,567.89" }));
    await waitFor(() => expect(row()).toContain("1,234,567.89 · 16/10/2026 · 14:30"));
    expect(normalized(preview.textContent)).toContain("1,234,567.89 · 16/10/2026 · 14:30");
  });

  it("keeps the header with Volver on screen (issue #176)", () => {
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={fakeApi({}).api} />);
    const back = screen.getByRole("link", { name: "Volver" });
    expect(back.closest("[data-sticky-header]")).toHaveClass("sticky", "top-0");
  });
});

describe("settings: formats (HU-E9-13)", () => {
  it("previews the installation's formats and stores each choice as it is made", async () => {
    const bodies: unknown[] = [];
    let me = meDto();
    const { api } = fakeApi({
      "PATCH /api/v1/me": async (request) => {
        const body = await request.json();
        bodies.push(body);
        me = patchedMe(body, me);
        return jsonResponse(me);
      },
    });
    const { container } = renderWithIntl(
      <SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />,
    );
    await open(FORMATS);
    const preview = screen.getByRole("status", { name: "Así se verá" });
    expect(preview).toHaveTextContent("1.234.567,89");
    expect(preview).toHaveTextContent("16/10/2026");
    expect(preview).toHaveTextContent("14:30");
    await userEvent.click(screen.getByRole("radio", { name: "1,234,567.89" }));
    await userEvent.click(screen.getByRole("radio", { name: "10/16/2026" }));
    await userEvent.click(screen.getByRole("radio", { name: "12 horas" }));
    await waitFor(() =>
      expect(bodies).toEqual([{ numberFormat: "COMMA_DOT" }, { dateFormat: "MDY" }, { timeFormat: "H12" }]),
    );
    expect(normalized(preview.textContent)).toContain("1,234,567.89");
    expect(normalized(preview.textContent)).toContain("10/16/2026");
    expect(normalized(preview.textContent)).toContain("2:30 PM");
    expect(await axeViolations(container)).toEqual([]);
  });

  it("labels a field that follows the rule and offers Reset on a changed one", async () => {
    const twelve = patchedMe({ timeFormat: "H12" });
    const { api, requests } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(meDto()) });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={twelve} api={api} />);
    await open(FORMATS);
    const date = screen.getByRole("group", { name: "Fecha" });
    expect(within(date).getByText("Predeterminado")).toBeInTheDocument();
    expect(within(date).getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    const time = screen.getByRole("group", { name: "Hora" });
    await userEvent.click(within(time).getByRole("button", { name: "Restablecer" }));
    expect(await requests[0]!.json()).toEqual({ timeFormat: null });
    expect(screen.getByRole("status", { name: "Así se verá" })).toHaveTextContent("14:30");
    expect(within(time).getByText("Predeterminado")).toBeInTheDocument();
  });

  it("shows a locked field read-only with its effective value and keeps the others editable", async () => {
    const base = meDto();
    const locked = {
      ...base,
      preferences: {
        ...base.preferences,
        stored: { ...base.preferences.stored, dateFormat: "MDY" as const },
        locked: ["dateFormat" as const],
      },
    };
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={locked} api={fakeApi({}).api} />);
    await open(FORMATS);
    const date = screen.getByRole("group", { name: "Fecha" });
    expect(within(date).getByText("Lo define tu instalación")).toBeInTheDocument();
    expect(within(date).getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    for (const radio of within(date).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(within(date).queryByRole("button", { name: "Restablecer" })).toBeNull();
    for (const radio of within(screen.getByRole("group", { name: "Hora" })).getAllByRole("radio"))
      expect(radio).toBeEnabled();
  });

  it("rolls a refused choice back and shows its error next to the field", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => problemResponse(409, "PreferenceLocked") });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await open(FORMATS);
    const numbers = screen.getByRole("group", { name: "Números" });
    await userEvent.click(within(numbers).getByRole("radio", { name: "1,234,567.89" }));
    await waitFor(() => expect(within(numbers).getByRole("radio", { name: "1.234.567,89" })).toBeChecked());
    expect(
      within(numbers).getByText("La instalación fija este ajuste y no se puede cambiar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Así se verá" })).toHaveTextContent("1.234.567,89");
  });
});

describe("settings: the way back (S1)", () => {
  it("has a Volver link to the given space home, next to the title", () => {
    renderWithIntl(<SettingsForm me={meDto()} backHref="/spaces/sp-household" api={fakeApi({}).api} />);
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-household");
    expect(screen.getByRole("heading", { level: 1, name: "Ajustes" })).toBeInTheDocument();
  });
});

describe("settings: feedback for every saved preference (U5)", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it("says Guardado next to the field that was stored, as a status, for about two seconds", async () => {
    const { api } = fakeApi({
      "PATCH /api/v1/me": () => jsonResponse(patchedMe({ numberFormat: "COMMA_DOT" })),
    });
    const { container } = renderWithIntl(
      <SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />,
    );
    await open(FORMATS);
    const numbers = screen.getByRole("group", { name: "Números" });
    expect(within(numbers).queryByRole("status")).toBeNull();
    await userEvent.click(within(numbers).getByRole("radio", { name: "1,234,567.89" }));
    const saved = await within(numbers).findByRole("status");
    expect(saved).toHaveTextContent("Guardado");
    // Only its own field says so.
    expect(within(screen.getByRole("group", { name: "Fecha" })).queryByRole("status")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    await act(async () => void vi.advanceTimersByTime(1900));
    expect(within(numbers).getByRole("status")).toHaveTextContent("Guardado");
    await act(async () => void vi.advanceTimersByTime(200));
    expect(within(numbers).queryByRole("status")).toBeNull();
  });

  it("starts the two seconds again when the same field is saved again", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(patchedMe({ dateFormat: "MDY" })) });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await open(FORMATS);
    const date = screen.getByRole("group", { name: "Fecha" });
    await userEvent.click(within(date).getByRole("radio", { name: "10/16/2026" }));
    await within(date).findByRole("status");
    await act(async () => void vi.advanceTimersByTime(1500));
    await userEvent.click(within(date).getByRole("radio", { name: "2026/10/16" }));
    await act(async () => void vi.advanceTimersByTime(1500));
    expect(within(date).getByRole("status")).toHaveTextContent("Guardado");
  });

  it("says nothing when the change was refused", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => problemResponse(409, "PreferenceLocked") });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await open(FORMATS);
    const numbers = screen.getByRole("group", { name: "Números" });
    await userEvent.click(within(numbers).getByRole("radio", { name: "1,234,567.89" }));
    await within(numbers).findByText("La instalación fija este ajuste y no se puede cambiar.");
    expect(screen.queryByText("Guardado")).toBeNull();
  });

  it("also says it for the time zone, the language and the theme", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(meDto({ timezone: "Europe/Madrid" })) });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria/ }));
    await userEvent.type(within(screen.getByRole("dialog")).getByLabelText("Buscar zona horaria"), "madr");
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("radio", { name: /Madrid/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("Guardado");
    await open(/^Apariencia e idioma/);
    const theme = screen.getByRole("group", { name: "Tema" });
    await userEvent.click(within(theme).getByRole("radio", { name: "Oscuro" }));
    expect(await within(theme).findByRole("status")).toHaveTextContent("Guardado");
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(
      await within(screen.getByRole("group", { name: "Idioma" })).findByRole("status"),
    ).toHaveTextContent("Guardado");
  });

  it("keeps Predeterminado and Restablecer in the same place: one fixed-size slot for both", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(patchedMe({ timeFormat: "H12" })) });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await open(FORMATS);
    const time = screen.getByRole("group", { name: "Hora" });
    const slot = () => within(time).getByTestId("preference-state");
    const before = slot().className;
    expect(within(slot()).getByText("Predeterminado")).toBeInTheDocument();
    await userEvent.click(within(time).getByRole("radio", { name: "12 horas" }));
    await within(slot()).findByRole("button", { name: "Restablecer" });
    expect(slot().className).toBe(before);
    expect(slot()).toHaveClass("h-11", "justify-end");
  });
});

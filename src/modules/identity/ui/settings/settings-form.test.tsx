import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { axeViolations } from "../../../../../tests/support/ui/axe";
import { meDto, normalized, patchedMe } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { SettingsForm } from "./settings-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => vi.clearAllMocks());

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
    const { container } = renderWithIntl(<SettingsForm me={meDto()} api={api} />);
    const preview = screen.getByRole("status");
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
    renderWithIntl(<SettingsForm me={twelve} api={api} />);
    const date = screen.getByRole("group", { name: "Fecha" });
    expect(within(date).getByText("Predeterminado")).toBeInTheDocument();
    expect(within(date).getByRole("radio", { name: "16/10/2026" })).toBeChecked();
    const time = screen.getByRole("group", { name: "Hora" });
    await userEvent.click(within(time).getByRole("button", { name: "Restablecer" }));
    expect(await requests[0]!.json()).toEqual({ timeFormat: null });
    expect(screen.getByRole("status")).toHaveTextContent("14:30");
    expect(within(time).getByText("Predeterminado")).toBeInTheDocument();
  });

  it("shows a locked field read-only with its effective value and keeps the others editable", () => {
    const base = meDto();
    const locked = {
      ...base,
      preferences: {
        ...base.preferences,
        stored: { ...base.preferences.stored, dateFormat: "MDY" as const },
        locked: ["dateFormat" as const],
      },
    };
    renderWithIntl(<SettingsForm me={locked} api={fakeApi({}).api} />);
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
    renderWithIntl(<SettingsForm me={meDto()} api={api} />);
    const numbers = screen.getByRole("group", { name: "Números" });
    await userEvent.click(within(numbers).getByRole("radio", { name: "1,234,567.89" }));
    await waitFor(() => expect(within(numbers).getByRole("radio", { name: "1.234.567,89" })).toBeChecked());
    expect(
      within(numbers).getByText("La instalación fija este ajuste y no se puede cambiar."),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1.234.567,89");
  });
});

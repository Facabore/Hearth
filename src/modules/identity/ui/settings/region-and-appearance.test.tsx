import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { meDto, normalized, patchedMe } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse, problemResponse } from "../../../../../tests/support/ui/fake-api";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import { SettingsForm } from "./settings-form";

const router = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
beforeEach(() => {
  vi.clearAllMocks();
  document.cookie = "hearth.locale=; path=/; max-age=0";
});

describe("settings: region, theme and language (HU-E9-13)", () => {
  it("shows the three sections", () => {
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={fakeApi({}).api} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Formatos",
      "Región",
      "Apariencia e idioma",
    ]);
  });

  it("finds a zone by searching and stores it", async () => {
    const { api, requests } = fakeApi({
      "PATCH /api/v1/me": () => jsonResponse(meDto({ timezone: "Europe/Madrid" })),
    });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria.*Bogota \(GMT-5\)/ }));
    const sheet = screen.getByRole("dialog", { name: "Zona horaria" });
    await userEvent.type(within(sheet).getByLabelText("Buscar zona horaria"), "madr");
    await userEvent.click(within(sheet).getByRole("radio", { name: /Madrid/ }));
    expect(await requests[0]!.json()).toEqual({ timezone: "Europe/Madrid" });
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria/ }));
    await userEvent.type(screen.getByLabelText("Buscar zona horaria"), "zzz");
    expect(screen.getByText("Ninguna zona coincide con «zzz».")).toBeInTheDocument();
  });

  it("keeps the theme on the device", async () => {
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={fakeApi({}).api} />);
    await userEvent.click(screen.getByRole("radio", { name: "Oscuro" }));
    expect(localStorage.getItem("hearth.theme")).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("changes only the texts when the language changes", async () => {
    const custom = patchedMe({ numberFormat: "COMMA_DOT", timeFormat: "H12" });
    const english = { ...custom, locale: "en" };
    const { api, requests } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(english) });
    const view = renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={custom} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(await requests[0]!.json()).toEqual({ locale: "en" });
    expect(router.refresh).toHaveBeenCalled();
    expect(document.cookie).toContain("hearth.locale=en");
    view.unmount();
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={english} api={api} />, { locale: "en" });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Settings");
    expect(normalized(screen.getByRole("status").textContent)).toContain("1,234,567.89");
    expect(normalized(screen.getByRole("status").textContent)).toContain("2:30 PM");
  });

  it("keeps the visitor cookie when the language change is refused", async () => {
    const { api } = fakeApi({ "PATCH /api/v1/me": () => problemResponse(409, "PreferenceLocked") });
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={api} />);
    await userEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(await screen.findByRole("radio", { name: "Español", checked: true })).toBeInTheDocument();
    expect(document.cookie).not.toContain("hearth.locale");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("sends the installation's zone, never null, when the zone is reset", async () => {
    const { api, requests } = fakeApi({ "PATCH /api/v1/me": () => jsonResponse(meDto()) });
    renderWithIntl(
      <SettingsForm backHref="/spaces/sp-personal" me={meDto({ timezone: "Europe/Madrid" })} api={api} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Restablecer" }));
    expect(await requests[0]!.json()).toEqual({ timezone: "America/Bogota" });
  });

  it("shows a locked zone and a locked language read-only", () => {
    const base = meDto();
    const locked = {
      ...base,
      preferences: { ...base.preferences, locked: ["timezone" as const, "locale" as const] },
    };
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={locked} api={fakeApi({}).api} />);
    expect(screen.getByRole("button", { name: /Zona horaria/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "English" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Oscuro" })).toBeEnabled();
  });

  it("draws at most fifty zones, so a long list stays fast", async () => {
    renderWithIntl(<SettingsForm backHref="/spaces/sp-personal" me={meDto()} api={fakeApi({}).api} />);
    await userEvent.click(screen.getByRole("button", { name: /Zona horaria/ }));
    expect(within(screen.getByRole("dialog")).getAllByRole("radio")).toHaveLength(50);
  });
});

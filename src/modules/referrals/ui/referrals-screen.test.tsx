import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/shared/ui/molecules/toast-provider";
import { axeViolations } from "../../../../tests/support/ui/axe";
import { normalized } from "../../../../tests/support/ui/dto";
import { renderWithIntl } from "../../../../tests/support/ui/render";
import type { MyReferralsDto } from "./dto";
import { InviteRow } from "./invite-row";
import { ReferralsScreen } from "./referrals-screen";

const LINK = "https://hearth.app/r/fabian-7k2qx9mt";
const referrals = (overrides: Partial<MyReferralsDto> = {}): MyReferralsDto => ({
  code: "fabian-7k2qx9mt",
  link: LINK,
  points: 2,
  items: [
    { firstName: "Andrés", joinedOn: "2026-11-12", counts: true },
    { firstName: "Yuberley", joinedOn: "2026-11-09", counts: false },
    { firstName: "Roger", joinedOn: "2026-11-02", counts: true },
  ],
  ...overrides,
});
const DOT = { numberFormat: "DOT_COMMA" } as const;
const DMY = { numberFormat: "DOT_COMMA", dateFormat: "DMY" } as const;

const renderScreen = (
  dto = referrals(),
  locale: "es" | "en" = "es",
  formats: { numberFormat: "DOT_COMMA"; dateFormat: "DMY" | "MDY" } = DMY,
) =>
  renderWithIntl(
    <ToastProvider>
      <ReferralsScreen backHref="/spaces/sp-personal/more" referrals={dto} formats={formats} />
    </ToastProvider>,
    { locale },
  );

afterEach(() => vi.unstubAllGlobals());

describe("Invitar a Hearth (D27, board 2)", () => {
  it("shows the points, the link, and who joined: +1 once their email is confirmed, a note until then", async () => {
    const { container } = renderScreen();
    expect(screen.getByRole("heading", { level: 1, name: "Invitar a Hearth" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute("href", "/spaces/sp-personal/more");
    expect(screen.getByText("Tus puntos").nextElementSibling).toHaveTextContent("2");
    expect(
      screen.getByText("Comparte tu enlace. Cada persona que crea su cuenta con él te suma un punto."),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Tu enlace" })).toHaveValue(LINK);
    const joined = screen.getByRole("region", { name: "Se unieron con tu enlace" });
    expect(
      within(joined)
        .getAllByRole("listitem")
        .map((row) => normalized(row.textContent)),
    ).toEqual([
      "AAndrésSe unió el 12 nov+1Suma un punto",
      "YYuberleyFalta que confirme su correo",
      "RRogerSe unió el 2 nov+1Suma un punto",
    ]);
    expect(
      screen.getByText("Por ahora los puntos solo se cuentan. Más adelante podrán darte ventajas."),
    ).toBeVisible();
    expect(await axeViolations(container)).toEqual([]);
  });

  it("writes the join day in the person's date format, the month's name in their language (D23)", () => {
    renderScreen(referrals(), "en", { numberFormat: "DOT_COMMA", dateFormat: "MDY" });
    const joined = screen.getByRole("region", { name: "Joined with your link" });
    expect(normalized(within(joined).getAllByRole("listitem")[0]!.textContent)).toContain("Joined Nov 12");
  });

  it("says nobody joined yet when the list is empty, in English too", () => {
    renderScreen(referrals({ points: 0, items: [] }), "en");
    expect(screen.getByText("Your points").nextElementSibling).toHaveTextContent("0");
    expect(screen.getByText(/Nobody has joined with your link yet/)).toBeVisible();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("writes the points in the person's number format", () => {
    renderScreen(referrals({ points: 1204 }));
    expect(screen.getByText("Tus puntos").nextElementSibling).toHaveTextContent("1.204");
  });

  it("copies the link and says so", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(writeText).toHaveBeenCalledWith(LINK);
    expect(await screen.findByText("Enlace copiado")).toBeVisible();
  });

  it("selects the link for a copy by hand when the clipboard refuses", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) },
    });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Copiar" }));
    expect(
      await screen.findByText("No pudimos copiar el enlace. Selecciónalo y cópialo a mano."),
    ).toBeVisible();
    const field = screen.getByRole("textbox", { name: "Tu enlace" }) as HTMLInputElement;
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, LINK.length]);
  });

  it("shares the link through the browser's sheet when there is one", async () => {
    const share = vi.fn(async () => undefined);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share, clipboard: { writeText } });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Compartir enlace" }));
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ url: LINK }));
    expect(writeText).not.toHaveBeenCalled();
  });

  it("copies the link instead when the browser cannot share", async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
    renderScreen();
    await userEvent.click(screen.getByRole("button", { name: "Compartir enlace" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LINK));
    expect(await screen.findByText("Enlace copiado")).toBeVisible();
  });
});

describe("Más's invite row (D27, board 1)", () => {
  it("opens Invitar a Hearth and says the points with their plural", () => {
    const { rerender } = renderWithIntl(
      <InviteRow href="/spaces/sp-personal/invite" points={3} formats={DOT} />,
    );
    const row = screen.getByRole("link", { name: /Invita a alguien a Hearth/ });
    expect(row).toHaveAttribute("href", "/spaces/sp-personal/invite");
    expect(row).toHaveTextContent("Llevas 3 puntos");
    rerender(<InviteRow href="/spaces/sp-personal/invite" points={1} formats={DOT} />);
    expect(row).toHaveTextContent("Llevas 1 punto");
    rerender(<InviteRow href="/spaces/sp-personal/invite" points={0} formats={DOT} />);
    expect(row).toHaveTextContent("Llevas 0 puntos");
  });

  it("still opens the screen, without the points, while they are unknown", () => {
    renderWithIntl(<InviteRow href="/spaces/sp-personal/invite" points={undefined} formats={DOT} />);
    expect(screen.getByRole("link", { name: "Invita a alguien a Hearth" })).not.toHaveTextContent("Llevas");
  });
});

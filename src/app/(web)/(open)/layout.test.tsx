import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithIntl } from "../../../../tests/support/ui/render";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), getMe: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getLocale: async () => "es" }));
vi.mock("@/shared/ui/api/server", () => ({ getMe: mocks.getMe }));

const { default: OpenLayout } = await import("./layout");

describe("open layout (HU-E9-05, ruling P157)", () => {
  it("shows the page to anyone, never redirects and asks the API nothing", async () => {
    renderWithIntl(await OpenLayout({ children: <p>invitation</p> }));
    expect(screen.getByText("invitation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cambiar idioma/ })).toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.getMe).not.toHaveBeenCalled();
  });
});

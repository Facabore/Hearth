import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: true,
  cookieLocale: undefined as string | undefined,
  acceptLanguage: "en-US,en;q=0.9" as string | null,
  getMe: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    has: (name: string) => mocks.session && name === "hearth.session_token",
    get: (name: string) =>
      name === "hearth.locale" && mocks.cookieLocale ? { value: mocks.cookieLocale } : undefined,
  }),
  headers: async () => ({ get: () => mocks.acceptLanguage }),
}));
vi.mock("next-intl/server", () => ({ getRequestConfig: (config: unknown) => config }));
vi.mock("@/shared/ui/api/server", () => ({ getMe: mocks.getMe }));
vi.mock("@/shared/ui/time/server-now", () => ({ serverNow: () => new Date("2026-10-21T12:00:00Z") }));

const { default: requestConfig } = (await import("./request")) as unknown as {
  default: () => Promise<{ locale: string; timeZone: string }>;
};

describe("the request's locale and zone (ruling P120)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session = true;
    mocks.cookieLocale = undefined;
    mocks.acceptLanguage = "en-US,en;q=0.9";
  });

  it("uses the signed-in person's stored locale and zone", async () => {
    mocks.getMe.mockResolvedValue({ locale: "es", timezone: "America/Lima" });
    expect(await requestConfig()).toMatchObject({ locale: "es", timeZone: "America/Lima" });
  });

  it("falls back to the visitor's language when the profile cannot be read (N2), instead of failing the page", async () => {
    mocks.getMe.mockRejectedValue(new Error("Reading the profile failed: Unknown"));
    mocks.cookieLocale = "es";
    expect(await requestConfig()).toMatchObject({ locale: "es", timeZone: "America/Bogota" });
    mocks.cookieLocale = undefined;
    expect(await requestConfig()).toMatchObject({ locale: "en" });
  });
});

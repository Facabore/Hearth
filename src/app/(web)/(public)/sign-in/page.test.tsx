import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ mode: vi.fn() }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/shared/ui/api/server", () => ({ getSignUpMode: mocks.mode }));

const { default: SignInPage } = await import("./page");

const props = async (search: { next?: string; expired?: string }) =>
  (await SignInPage({ searchParams: Promise.resolve(search) })).props as {
    next: string;
    expired: boolean;
    signUp: string;
  };

describe("sign-in page (HU-E9-01, rulings P143 and P151)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the sign-up mode on the server and hands it to the form", async () => {
    mocks.mode.mockResolvedValue("closed");
    expect((await props({})).signUp).toBe("closed");
    mocks.mode.mockResolvedValue("open");
    expect((await props({})).signUp).toBe("open");
  });

  it("marks an expired session only for expired=1, and keeps next safe", async () => {
    mocks.mode.mockResolvedValue("open");
    expect(await props({ next: "/settings", expired: "1" })).toMatchObject({
      next: "/settings",
      expired: true,
    });
    expect(await props({ next: "//evil.example", expired: "yes" })).toMatchObject({
      next: "/",
      expired: false,
    });
    expect((await props({})).expired).toBe(false);
  });
});

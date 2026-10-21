import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getMe: vi.fn(),
  getSpaces: vi.fn(),
  redirectToSignIn: vi.fn(async (): Promise<never> => {
    throw new Error("NEXT_REDIRECT /sign-in");
  }),
  notFound: vi.fn((): never => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/shared/ui/api/server", () => ({
  getMe: mocks.getMe,
  getSpaces: mocks.getSpaces,
  redirectToSignIn: mocks.redirectToSignIn,
}));

const { AppShellContainer } = await import("./app-shell-container");

const personal = { id: "sp-personal", name: "Personal", kind: "PERSONAL", role: "OWNER" };
const household = { id: "sp-household", name: "Household", kind: "SHARED", role: "MEMBER" };
const me = (locale: string) => ({ id: "u-ana", name: "Ana", email: "ana@example.com", locale });

/** The shell element the container returns; its props are what the presentational AppShell receives. */
const shellOf = async (spaceId: string | null) => {
  const element = await AppShellContainer({ spaceId, children: null });
  return (element as unknown as { props: Record<string, unknown> }).props;
};

describe("app shell container (HU-E9-01, rulings P125 and P149)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSpaces.mockResolvedValue([personal, household]);
  });

  it("hands the shell the person's stored language, so sign-out can keep it for the sign-in screen", async () => {
    mocks.getMe.mockResolvedValue(me("en"));
    expect(await shellOf(null)).toMatchObject({
      me: { name: "Ana", email: "ana@example.com", locale: "en" },
    });
  });

  it("narrows a stored language the interface does not have to Spanish", async () => {
    mocks.getMe.mockResolvedValue(me("pt"));
    expect(await shellOf(null)).toMatchObject({ me: { locale: "es" } });
  });

  it("makes the URL's space active, and the personal one without an id", async () => {
    mocks.getMe.mockResolvedValue(me("es"));
    expect(await shellOf("sp-household")).toMatchObject({ activeSpace: { id: "sp-household" } });
    expect(await shellOf(null)).toMatchObject({ activeSpace: { id: "sp-personal" } });
  });

  it("sends an expired session to the sign-in screen and reads no spaces", async () => {
    mocks.getMe.mockResolvedValue(null);
    await expect(shellOf(null)).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(mocks.getSpaces).not.toHaveBeenCalled();
  });

  it("answers not found for a space the person is not in", async () => {
    mocks.getMe.mockResolvedValue(me("es"));
    await expect(shellOf("sp-gone")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

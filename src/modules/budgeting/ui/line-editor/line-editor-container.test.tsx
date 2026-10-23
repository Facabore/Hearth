import { screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cop, meDto, spaceDto } from "../../../../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../../../../tests/support/ui/fake-api";
import {
  householdDto,
  planLineDto,
  referencePlanDto,
  savingsAccountDto,
} from "../../../../../tests/support/ui/plan-dto";
import { renderWithIntl } from "../../../../../tests/support/ui/render";
import es from "@/i18n/messages/es.json";
import type { BudgetPlanDto } from "@/shared/ui/api/dto";

const served = vi.hoisted(() => ({ api: undefined as unknown, role: "OWNER" as string }));
vi.mock("next/headers", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) =>
    createTranslator({ locale: "es", messages: es, namespace } as never),
}));
vi.mock("@/shared/ui/api/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/shared/ui/api/server")>()),
  getMe: async () => meDto(),
  getSpaces: async () => [
    householdDto({ role: served.role as "OWNER" | "MEMBER" | "VIEWER" }),
    spaceDto({ id: "sp-personal", kind: "PERSONAL", name: "Personal" }),
  ],
  serverApi: async () => served.api,
}));
const { LineEditorContainer } = await import("./line-editor-container");

const serve = (plan: BudgetPlanDto, role = "OWNER") => {
  served.role = role;
  const fake = fakeApi({
    "GET /api/v1/spaces/{spaceId}/plans/{planId}": () => jsonResponse(plan),
    "GET /api/v1/spaces/{spaceId}/accounts": () =>
      jsonResponse({ items: [savingsAccountDto()], totals: { available: cop(0), netWorth: cop(0) } }),
  });
  served.api = fake.api;
  return fake.requests;
};
const rendered = async (lineId: string | null) =>
  (await LineEditorContainer({ spaceId: "sp-household", planId: "p-nov", lineId })) as ReactElement<{
    line: { id: string } | null;
    savingsAccounts: { id: string }[];
  }>;

beforeEach(() => vi.clearAllMocks());

describe("LineEditorContainer (HU-E9-08)", () => {
  it("hands the editor the line and the savings accounts of the caller's personal space only", async () => {
    const requests = serve(referencePlanDto());
    const element = await rendered("l-home");
    expect(element.props.line?.id).toBe("l-home");
    expect(element.props.savingsAccounts.map((account) => account.id)).toEqual(["a-savings"]);
    const accounts = requests.filter((request) => new URL(request.url).pathname.endsWith("/accounts"));
    expect(accounts.map((request) => new URL(request.url).pathname)).toEqual([
      "/api/v1/spaces/sp-personal/accounts",
    ]);
  });

  it("hands the editor no line to add one", async () => {
    serve(referencePlanDto());
    expect((await rendered(null)).props.line).toBeNull();
  });

  it("answers not found for a line the plan does not have", async () => {
    serve(referencePlanDto());
    await expect(rendered("l-nope")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each([
    ["a MEMBER", referencePlanDto(), "MEMBER"],
    ["a VIEWER", referencePlanDto(), "VIEWER"],
    ["a manager of a CLOSED plan", referencePlanDto({ status: "CLOSED" }), "OWNER"],
  ])("shows %s a read-only note and the way back", async (_who, plan, role) => {
    serve(plan, role);
    renderWithIntl(
      <>{await LineEditorContainer({ spaceId: "sp-household", planId: "p-nov", lineId: "l-home" })}</>,
    );
    expect(
      screen.getByText("Solo Propietario y Administrador editan las líneas de un plan abierto."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Volver" })).toHaveAttribute(
      "href",
      "/spaces/sp-household/plans/p-nov",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the line in the read-only title", async () => {
    serve(referencePlanDto(), "MEMBER");
    renderWithIntl(
      <>{await LineEditorContainer({ spaceId: "sp-household", planId: "p-nov", lineId: "l-home" })}</>,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: `Línea ${planLineDto().name}` }),
    ).toBeInTheDocument();
  });
});

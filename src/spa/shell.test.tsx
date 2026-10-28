import { QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { Suspense, type ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { householdSpace, meDto, spaceDto } from "../../tests/support/ui/dto";
import { fakeApi, jsonResponse } from "../../tests/support/ui/fake-api";
import { ApisProvider } from "./api";
import { createQueryClient } from "./app";
import { useShell } from "./shell";

/** The shell's query hook over a fake /api/v1 (ADR 0006: a container becomes a query hook plus a component). */
const renderShell = (spaceId: string | null, from?: string) => {
  const { api, requests } = fakeApi({
    "GET /api/v1/me": () => jsonResponse(meDto({ locale: "en" })),
    "GET /api/v1/spaces": () => jsonResponse({ items: [spaceDto(), householdSpace()] }),
  });
  const queryClient = createQueryClient();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ApisProvider apis={{ api, sessionApi: api }}>
        <Suspense>{children}</Suspense>
      </ApisProvider>
    </QueryClientProvider>
  );
  return { ...renderHook(() => useShell(spaceId, from), { wrapper }), requests, queryClient };
};

describe("useShell", () => {
  it("reads the person and their spaces once, and hands the shell the URL's space", async () => {
    const { result, requests } = renderShell("sp-household");
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current).toEqual({
      me: { name: "Ana", email: "ana@example.com", locale: "en" },
      spaces: [spaceDto(), householdSpace()],
      activeSpace: householdSpace(),
    });
    expect(requests.map((r) => `${r.method} ${new URL(r.url).pathname}`).sort()).toEqual([
      "GET /api/v1/me",
      "GET /api/v1/spaces",
    ]);
  });

  it("is null for a space the person is not in", async () => {
    const { result, queryClient } = renderShell("sp-stranger");
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await waitFor(() => expect(result.current).toBeNull());
  });

  it("opens a screen without a space on the space `?from=` names, when it is one of the person's own (N3)", async () => {
    const { result } = renderShell(null, "sp-household");
    await waitFor(() => expect(result.current?.activeSpace.id).toBe("sp-household"));
  });

  it("ignores a `?from=` that is not one of the person's spaces and opens the personal one", async () => {
    const { result } = renderShell(null, "sp-stranger");
    await waitFor(() => expect(result.current?.activeSpace.id).toBe("sp-personal"));
  });
});

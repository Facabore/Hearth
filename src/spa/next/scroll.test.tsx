import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Link from "./link";
import { useRouter } from "./navigation";

function Screen() {
  const router = useRouter();
  return (
    <>
      <Link href="/list?filter=a" scroll={false}>
        keep place
      </Link>
      <Link href="/list?filter=b">to top</Link>
      <button type="button" onClick={() => router.push("/list?filter=c", { scroll: false })}>
        push, keep place
      </button>
      <button type="button" onClick={() => router.replace("/list?filter=d", { scroll: false })}>
        replace, keep place
      </button>
      <button type="button" onClick={() => router.push("/list?filter=e")}>
        push
      </button>
    </>
  );
}

const renderList = () => {
  const root = createRootRoute();
  const list = createRoute({ getParentRoute: () => root, path: "/list", component: Screen });
  const router = createRouter({
    routeTree: root.addChildren([list]),
    history: createMemoryHistory({ initialEntries: ["/list"] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
};

let scrollTo: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

/** Each case navigates once and checks whether the router put the screen back at the top for it. */
const navigates = async (name: string, filter: string, router: ReturnType<typeof renderList>) => {
  scrollTo.mockClear();
  await userEvent.click(screen.getByText(name));
  await waitFor(() => expect(router.state.location.searchStr).toBe(`?filter=${filter}`));
  await waitFor(() => expect(router.state.status).toBe("idle"));
};

describe("Next.js's scroll option in the SPA (#201)", () => {
  it("keeps the place on a Link with scroll={false}, and goes to the top on any other", async () => {
    const router = renderList();
    await screen.findByText("keep place");
    await navigates("keep place", "a", router);
    expect(scrollTo).not.toHaveBeenCalled();
    await navigates("to top", "b", router);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0, left: 0 }));
  });

  it("keeps the place on push and replace with { scroll: false }, and goes to the top without it", async () => {
    const router = renderList();
    await screen.findByText("keep place");
    await navigates("push, keep place", "c", router);
    expect(scrollTo).not.toHaveBeenCalled();
    await navigates("replace, keep place", "d", router);
    expect(scrollTo).not.toHaveBeenCalled();
    await navigates("push", "e", router);
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0, left: 0 }));
  });
});

import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTrail, stepsBack, writeTrail, type Trail } from "./history";
import { NavigationTracker } from "./navigation-tracker";

const trailOf = (urls: string[], pos = urls.length - 1): Trail => ({ urls, pos });
const here = () => `${window.location.pathname}${window.location.search}`;

/** How the browser says this document was loaded: "navigate" (a typed URL, an outside link), "reload", "back_forward". */
const loadedBy = (type: string) =>
  vi.spyOn(performance, "getEntriesByType").mockReturnValue([{ type } as PerformanceNavigationTiming]);

/** The page the person is on when the app starts, with the trail the tab already held. */
const openAt = (url: string, trail: Trail = readTrail()) => {
  window.history.replaceState({}, "", url);
  writeTrail(trail);
};

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState({}, "", "/");
});
afterEach(() => vi.restoreAllMocks());

describe("navigation tracker: starting", () => {
  it("renders nothing", () => {
    const { container } = render(<NavigationTracker />);
    expect(container).toBeEmptyDOMElement();
  });

  it("starts a new trail when the page is opened by a URL: that is not a step in the tab's history", () => {
    loadedBy("navigate");
    openAt("/spaces/s1/accounts", trailOf(["/spaces/s1/transactions", "/spaces/s1/accounts"]));
    render(<NavigationTracker />);
    expect(readTrail()).toEqual(trailOf(["/spaces/s1/accounts"]));
  });

  it.each(["reload", "back_forward"])("keeps the trail when the page is loaded again by a %s", (type) => {
    loadedBy(type);
    openAt("/spaces/s1/accounts", trailOf(["/spaces/s1/transactions", "/spaces/s1/accounts"]));
    render(<NavigationTracker />);
    expect(readTrail()).toEqual(trailOf(["/spaces/s1/transactions", "/spaces/s1/accounts"]));
  });

  it("starts a new trail when the stored one is not where the page is", () => {
    loadedBy("reload");
    openAt("/settings", trailOf(["/spaces/s1/transactions", "/spaces/s1/accounts"]));
    render(<NavigationTracker />);
    expect(readTrail()).toEqual(trailOf(["/settings"]));
  });
});

describe("navigation tracker: the entries the app makes", () => {
  beforeEach(() => {
    loadedBy("navigate");
  });

  it("adds an entry for each push, as pathname plus search", () => {
    openAt("/spaces/s1/transactions?period=2026-10");
    render(<NavigationTracker />);
    window.history.pushState({}, "", "/spaces/s1/accounts?returnTo=%2Fspaces%2Fs1");
    expect(readTrail()).toEqual(
      trailOf(["/spaces/s1/transactions?period=2026-10", "/spaces/s1/accounts?returnTo=%2Fspaces%2Fs1"]),
    );
    expect(JSON.parse(window.sessionStorage.getItem("hearth:navigation")!)).toHaveProperty("pos", 1);
  });

  it("restarts the trail when the person switches tab", () => {
    openAt("/spaces/s1/transactions");
    render(<NavigationTracker />);
    window.history.pushState({}, "", "/spaces/s1/accounts");
    window.history.pushState({}, "", "/spaces/s1");
    expect(readTrail()).toEqual(trailOf(["/spaces/s1"]));
  });

  it("replaces the current entry instead of adding one: the form that saved leaves no step", () => {
    openAt("/spaces/s1/transactions");
    render(<NavigationTracker />);
    window.history.pushState({}, "", "/spaces/s1/accounts");
    window.history.pushState({}, "", "/spaces/s1/accounts/new");
    window.history.replaceState({}, "", "/spaces/s1/accounts");
    expect(readTrail()).toEqual(
      trailOf(["/spaces/s1/transactions", "/spaces/s1/accounts", "/spaces/s1/accounts"]),
    );
    expect(stepsBack(readTrail(), here())).toBe(2);
  });

  it("ignores a replace that keeps the URL, which the router makes while it settles", () => {
    openAt("/spaces/s1/accounts");
    render(<NavigationTracker />);
    window.history.pushState({}, "", "/settings");
    window.history.replaceState({ settled: true }, "", "/settings");
    expect(readTrail()).toEqual(trailOf(["/spaces/s1/accounts", "/settings"]));
  });

  it("counts every entry of the browser's history: balance periods are steps Volver skips", () => {
    openAt("/spaces/s1/balances");
    render(<NavigationTracker />);
    window.history.pushState({}, "", "/spaces/s1/members/m1/history");
    window.history.pushState({}, "", "/spaces/s1/members/m1/history?from=2026-09-01");
    window.history.pushState({}, "", "/spaces/s1/members/m1/history?from=2026-08-01");
    expect(stepsBack(readTrail(), here())).toBe(3);
  });

  it("follows a push to an absolute URL of the same origin", () => {
    openAt("/spaces/s1/transactions");
    render(<NavigationTracker />);
    window.history.pushState({}, "", `${window.location.origin}/settings?from=s1`);
    expect(readTrail().urls.at(-1)).toBe("/settings?from=s1");
  });

  it("moves along the trail when the browser goes back", async () => {
    openAt("/spaces/s1/transactions");
    render(<NavigationTracker />);
    window.history.pushState({}, "", "/spaces/s1/accounts");
    window.history.pushState({}, "", "/settings");
    window.history.back();
    await waitFor(() =>
      expect(readTrail()).toEqual(
        trailOf(["/spaces/s1/transactions", "/spaces/s1/accounts", "/settings"], 1),
      ),
    );
  });

  it("keeps working, and records nothing, when sessionStorage throws", () => {
    openAt("/spaces/s1/transactions");
    window.sessionStorage.clear();
    for (const method of ["getItem", "setItem"] as const)
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
    render(<NavigationTracker />);
    expect(() => window.history.pushState({}, "", "/spaces/s1/accounts")).not.toThrow();
    expect(() => window.history.replaceState({}, "", "/settings")).not.toThrow();
    vi.restoreAllMocks();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("stops recording, and puts the history methods back, when it unmounts", () => {
    openAt("/spaces/s1/transactions");
    const { pushState, replaceState } = window.history;
    const view = render(<NavigationTracker />);
    expect(window.history.pushState).not.toBe(pushState);
    view.unmount();
    expect(window.history.pushState).toBe(pushState);
    expect(window.history.replaceState).toBe(replaceState);
    window.history.pushState({}, "", "/settings");
    expect(readTrail()).toEqual(trailOf(["/spaces/s1/transactions"]));
  });
});

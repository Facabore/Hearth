import { afterEach, describe, expect, it } from "vitest";
import {
  appLocation,
  setAppBase,
  MAX_ENTRIES,
  isAuthScreen,
  isRootScreen,
  pushed,
  readTrail,
  replaced,
  stepsBack,
  cameFrom,
  traversed,
  writeTrail,
  type Trail,
} from "./history";

const home = "/spaces/s1";
const movements = "/spaces/s1/transactions";
const balances = "/spaces/s1/balances";
const plan = "/spaces/s1/plan";
const accounts = "/spaces/s1/accounts";
const create = "/spaces/s1/accounts/new";
const settings = "/settings";
const members = "/spaces/s1/members";
const period = (n: number) => `/spaces/s1/members/m1/history?from=2026-0${n}-01`;
const trailOf = (urls: string[], pos = urls.length - 1): Trail => ({ urls, pos });
const EMPTY: Trail = { urls: [], pos: -1 };

describe("root screens (the bottom navigation's destinations)", () => {
  it.each([home, movements, balances, plan, "/", `${movements}?period=2026-10`, `${plan}?period=2026-11`])(
    "%s is a root",
    (path) => {
      expect(isRootScreen(path)).toBe(true);
    },
  );

  it.each([
    "/spaces/s1/plans/p1",
    "/spaces/s1/plans/p1/lines/new",
    accounts,
    create,
    "/spaces/s1/new",
    "/spaces/new",
    members,
    settings,
    "/sign-in",
  ])("%s is a screen below the navigation", (path) => {
    expect(isRootScreen(path)).toBe(false);
  });
});

describe("auth and invitation screens", () => {
  it.each(["/sign-in", "/sign-up?next=%2Fsettings", "/invitations/tok", "/claims/tok"])(
    "%s is one",
    (path) => {
      expect(isAuthScreen(path)).toBe(true);
    },
  );

  it.each([home, accounts, "/invitations", "/settings"])("%s is not one", (path) => {
    expect(isAuthScreen(path)).toBe(false);
  });
});

describe("cameFrom: the entry before the current one", () => {
  const open = `${movements}?tx=t-1`;
  it("is the previous entry when the trail stands on the current URL", () => {
    expect(cameFrom(trailOf([movements, open]), open)).toBe(movements);
  });

  it("is null at the first entry, on a stale trail and on an empty one", () => {
    expect(cameFrom(trailOf([open]), open)).toBeNull();
    expect(cameFrom(trailOf([movements, open]), `${movements}?tx=other`)).toBeNull();
    expect(cameFrom(EMPTY, open)).toBeNull();
  });

  it("follows the position, not the end of the trail", () => {
    expect(cameFrom(trailOf([home, movements, open], 1), movements)).toBe(home);
  });
});

describe("pushed: a new entry in the browser's history", () => {
  it("starts the trail at the first entry", () => {
    expect(pushed(EMPTY, accounts)).toEqual(trailOf([accounts]));
  });

  it("appends a screen below the navigation and moves to it", () => {
    expect(pushed(trailOf([movements]), accounts)).toEqual(trailOf([movements, accounts]));
  });

  it("restarts the trail at a root: switching tabs is not a history to unwind", () => {
    expect(pushed(trailOf([movements, accounts]), home)).toEqual(trailOf([home]));
    expect(pushed(trailOf([home]), movements)).toEqual(trailOf([movements]));
  });

  it("keeps the entry before a query-only push on a root: the screen has not changed, so nothing restarts", () => {
    expect(pushed(trailOf([movements]), `${movements}?tx=t-1`)).toEqual(
      trailOf([movements, `${movements}?tx=t-1`]),
    );
    expect(pushed(trailOf([home, `${home}?tx=t-1`]), `${home}?tx=t-2`)).toEqual(
      trailOf([home, `${home}?tx=t-1`, `${home}?tx=t-2`]),
    );
  });

  it("still restarts when a root is entered from another screen with the same query", () => {
    expect(pushed(trailOf([home, accounts]), `${home}?tx=t-1`)).toEqual(trailOf([`${home}?tx=t-1`]));
  });

  it("drops the entries ahead of the current one, as the browser does", () => {
    expect(pushed(trailOf([movements, accounts, settings], 1), members)).toEqual(
      trailOf([movements, accounts, members]),
    );
  });

  it("keeps the same URL as a new entry, because the browser does", () => {
    expect(pushed(trailOf([movements, accounts]), accounts)).toEqual(
      trailOf([movements, accounts, accounts]),
    );
  });

  it("keeps at most MAX_ENTRIES entries, dropping the oldest", () => {
    let trail = EMPTY;
    for (let i = 0; i < MAX_ENTRIES + 5; i += 1) trail = pushed(trail, `/spaces/s1/members/m${i}/history`);
    expect(trail.urls).toHaveLength(MAX_ENTRIES);
    expect(trail.pos).toBe(MAX_ENTRIES - 1);
    expect(trail.urls.at(-1)).toBe(`/spaces/s1/members/m${MAX_ENTRIES + 4}/history`);
  });
});

describe("replaced: the current entry takes another URL", () => {
  it("is not a new entry: the form that saved is not in the trail", () => {
    // Movimientos, Cuentas, the creation form; saving replaces the form with Cuentas.
    expect(replaced(trailOf([movements, accounts, create]), accounts)).toEqual(
      trailOf([movements, accounts, accounts]),
    );
  });

  it("replaces only the current entry", () => {
    expect(replaced(trailOf([movements, accounts, settings], 1), members)).toEqual(
      trailOf([movements, members, settings], 1),
    );
  });

  it("restarts the trail when it lands on a root", () => {
    expect(replaced(trailOf([movements, accounts, create]), home)).toEqual(trailOf([home]));
  });

  it("starts the trail when there is none", () => {
    expect(replaced(EMPTY, members)).toEqual(trailOf([members]));
  });
});

describe("traversed: the browser went back or forward to a URL", () => {
  it("moves to the entry it lands on", () => {
    expect(traversed(trailOf([movements, accounts]), movements)).toEqual(trailOf([movements]));
    expect(traversed(trailOf([movements, accounts, settings]), accounts)).toEqual(
      trailOf([movements, accounts, settings], 1),
    );
  });

  it("prefers the nearest entry with that URL, going back first", () => {
    expect(traversed(trailOf([movements, accounts, members, accounts], 2), accounts)).toEqual(
      trailOf([movements, accounts, members, accounts], 1),
    );
    expect(traversed(trailOf([accounts, members, accounts, settings], 3), accounts)).toEqual(
      trailOf([accounts, members, accounts, settings], 2),
    );
  });

  it("starts a new trail when it lands somewhere the trail does not know", () => {
    expect(traversed(trailOf([movements, accounts]), settings)).toEqual(trailOf([settings]));
    expect(traversed(EMPTY, accounts)).toEqual(trailOf([accounts]));
  });

  it("restarts the trail when it lands on a root", () => {
    expect(traversed(trailOf([home, movements, accounts]), movements)).toEqual(trailOf([movements]));
  });
});

describe("stepsBack: how far the browser goes to reach the previous screen", () => {
  it("is null with nothing before the screen", () => {
    expect(stepsBack(EMPTY, accounts)).toBeNull();
    expect(stepsBack(trailOf([accounts]), accounts)).toBeNull();
  });

  it("is one step to the screen she came from", () => {
    expect(stepsBack(trailOf([movements, accounts]), accounts)).toBe(1);
  });

  it("skips the entries of the same screen: a query changing, a form replaced by its screen", () => {
    expect(stepsBack(trailOf([movements, accounts, accounts]), accounts)).toBe(2);
    expect(stepsBack(trailOf([balances, period(1), period(2), period(3)]), period(3))).toBe(3);
  });

  it("goes back from the middle of the trail", () => {
    expect(stepsBack(trailOf([movements, accounts, settings], 1), accounts)).toBe(1);
  });

  it("is null when the previous screen is a sign-in, sign-up or invitation screen", () => {
    expect(stepsBack(trailOf(["/sign-in?next=%2Fspaces%2Fs1%2Fmembers", members]), members)).toBeNull();
    expect(stepsBack(trailOf(["/invitations/tok", home]), home)).toBeNull();
    expect(stepsBack(trailOf(["/claims/tok", members]), members)).toBeNull();
  });

  it("is null when the trail's current entry is not the screen the person is on (a stale trail)", () => {
    expect(stepsBack(trailOf([movements, accounts]), settings)).toBeNull();
    expect(stepsBack(trailOf([movements, accounts]), `${accounts}?x=1`)).toBe(1);
  });
});

/** A `Storage` the tests drive, with the failures a private window or blocked site data cause. */
const storageOf = (failures: { get?: boolean; set?: boolean } = {}) => {
  const data = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      if (failures.get) throw new DOMException("blocked", "SecurityError");
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (failures.set) throw new DOMException("full", "QuotaExceededError");
      data.set(key, value);
    },
  };
  return { storage, data };
};

describe("the trail in sessionStorage", () => {
  it("is stored as pathname plus search and read back", () => {
    const { storage, data } = storageOf();
    const trail = trailOf([movements, `${accounts}?returnTo=%2Fspaces%2Fs1`]);
    writeTrail(trail, storage);
    expect(JSON.parse([...data.values()][0]!)).toEqual(trail);
    expect(readTrail(storage)).toEqual(trail);
  });

  it("reads no trail and writes nothing, without throwing, when storage throws on every access", () => {
    const { storage } = storageOf({ get: true, set: true });
    expect(() => writeTrail(trailOf([movements, accounts]), storage)).not.toThrow();
    expect(readTrail(storage)).toEqual(EMPTY);
  });

  it("reads no trail when a write is refused (a full quota)", () => {
    const { storage } = storageOf({ set: true });
    writeTrail(trailOf([movements]), storage);
    expect(readTrail(storage)).toEqual(EMPTY);
  });

  it("reads no trail, without throwing, when there is no storage at all", () => {
    expect(() => writeTrail(trailOf([movements]), undefined)).not.toThrow();
    expect(readTrail(undefined)).toEqual(EMPTY);
  });

  it.each([
    "not json",
    "[]",
    '{"urls":"/x","pos":0}',
    '{"urls":["/x"],"pos":1}',
    '{"urls":["/x"],"pos":-1}',
    '{"urls":[1],"pos":0}',
    '{"urls":["/x"]}',
    "null",
  ])("ignores stored garbage %s", (raw) => {
    const { storage, data } = storageOf();
    data.set("hearth:navigation", raw);
    expect(readTrail(storage)).toEqual(EMPTY);
  });
});

describe("appLocation (ADR 0006: the single-page app under /app)", () => {
  afterEach(() => setAppBase(""));

  it("is the browser's own path in the Next.js UI, which has no base", () => {
    expect(appLocation({ pathname: "/app/spaces/s-1", search: "?tx=t-1" })).toEqual({
      pathname: "/app/spaces/s-1",
      search: "?tx=t-1",
    });
  });

  it("drops the app's base, so the trail and the sheet compare the paths the screens link to", () => {
    setAppBase("/app");
    expect(appLocation({ pathname: "/app/spaces/s-1/transactions", search: "?tx=t-1" })).toEqual({
      pathname: "/spaces/s-1/transactions",
      search: "?tx=t-1",
    });
    expect(appLocation({ pathname: "/app", search: "" }).pathname).toBe("/");
    // Only the base as a whole segment: another path that starts with the same letters is left as it is.
    expect(appLocation({ pathname: "/apple-icon.png", search: "" }).pathname).toBe("/apple-icon.png");
  });
});

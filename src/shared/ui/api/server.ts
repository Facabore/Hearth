// Server Components only: it reads the request's headers. Client code uses browserApi().
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { createApi, type Api } from "./client";
import type { MeDto, SignUpMode, SpaceDto } from "./dto";
import { problemFrom, type Problem } from "./problem";
import { PATH_HEADER } from "./server-headers";
import { hasSession } from "./session";

/** Ruling P117: Server Components read /api/v1 over loopback, unless the deployment names another origin. */
export const internalOrigin = (env: Record<string, string | undefined> = process.env): string =>
  env.INTERNAL_API_ORIGIN ?? `http://127.0.0.1:${env.PORT ?? 3000}`;

/** Only the session cookie, the client's address (the throttles see the real client) and the language travel. */
export const forwardedHeaders = (incoming: Headers): Record<string, string> => {
  const forwarded: Record<string, string> = {};
  const cookie = incoming.get("cookie");
  if (cookie) forwarded.cookie = cookie;
  const client = incoming.get("x-forwarded-for") ?? incoming.get("x-real-ip");
  if (client) forwarded["x-forwarded-for"] = client;
  const language = incoming.get("accept-language");
  if (language) forwarded["accept-language"] = language;
  return forwarded;
};

/** One client per request (React `cache`), carrying the request's forwarded headers. */
export const serverApi = cache(async (): Promise<Api> =>
  createApi({ baseUrl: internalOrigin(), headers: forwardedHeaders(await headers()) }),
);

export type Outcome<T> =
  | { kind: "ok"; data: T }
  | { kind: "unauthenticated" }
  | { kind: "missing" }
  | { kind: "problem"; problem: Problem };

export const outcomeOf = <T>(result: { data?: T; error?: unknown; response: Response }): Outcome<T> => {
  if (result.response.status === 401) return { kind: "unauthenticated" };
  if (result.response.status === 404) return { kind: "missing" };
  if (result.error !== undefined || result.data === undefined)
    return { kind: "problem", problem: problemFrom(result.error, result.response) };
  return { kind: "ok", data: result.data };
};

export type Loaded<T> = { ok: true; data: T } | { ok: false; problem: Problem };

/** A page's read: 401 goes to the sign-in screen with `next`, 404 to the not-found page, the rest is data or a problem. */
export const loaded = async <T>(
  call: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<Loaded<T>> => {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await call;
  } catch (error) {
    return { ok: false, problem: problemFrom(error, undefined) };
  }
  const outcome = outcomeOf(result);
  switch (outcome.kind) {
    case "ok":
      return { ok: true, data: outcome.data };
    case "unauthenticated":
      redirect("/sign-in?next=" + encodeURIComponent((await headers()).get(PATH_HEADER) ?? "/"));
    // falls through: redirect never returns
    case "missing":
      notFound();
    // falls through: notFound never returns
    case "problem":
      return { ok: false, problem: outcome.problem };
  }
};

/**
 * The profile answer as the signed-in person, or null on a 401. Any other failure throws to the error page: reading
 * it as "signed out" would send a signed-in person to the sign-in screen, which sends them back (ruling P145).
 */
export const meFrom = <T>(result: { data?: T; error?: unknown; response: Response }): T | null => {
  const outcome = outcomeOf(result);
  if (outcome.kind === "ok") return outcome.data;
  if (outcome.kind === "unauthenticated") return null;
  const code = outcome.kind === "problem" ? outcome.problem.code : "NotFound";
  throw new Error(`Reading the profile failed: ${code}`);
};

/** The signed-in person, or null without a session (no call is made then) or when the API says 401. */
export const getMe = cache(async (): Promise<MeDto | null> => {
  if (!hasSession(await cookies())) return null;
  return meFrom(await (await serverApi()).GET("/api/v1/me"));
});

/**
 * Ruling P143: closed only when the API says so. A failed read must not take the sign-in screen down, so it answers
 * open; the sign-up call answers `SignUpClosed` by itself when the installation is closed.
 */
export const signUpModeFrom = (result: {
  data?: { signUp: SignUpMode };
  error?: unknown;
  response: Response;
}): SignUpMode => (result.data?.signUp === "closed" ? "closed" : "open");

/** Whether the installation takes sign-ups from anyone (`open`) or only from invitees (`closed`); public endpoint. */
export const getSignUpMode = cache(async (): Promise<SignUpMode> => {
  try {
    return signUpModeFrom(await (await serverApi()).GET("/api/v1/auth/sign-up"));
  } catch {
    return "open";
  }
});

/** The person's spaces; the shell cannot render without them, so a problem throws to the error page. */
export const getSpaces = cache(async (): Promise<SpaceDto[]> => {
  const result = await loaded((await serverApi()).GET("/api/v1/spaces"));
  if (!result.ok) throw new Error(`Listing the spaces failed: ${result.problem.code}`);
  return result.data.items;
});

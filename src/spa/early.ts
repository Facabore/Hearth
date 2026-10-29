import type { QueryClient } from "@tanstack/react-query";
import type { MeDto, SpaceDto } from "@/shared/ui/api/dto";
import { meFrom, signUpModeFrom } from "@/shared/ui/api/readers";
import type { SpaApis } from "./api";
import { meQuery, signUpModeQuery, spacesFrom, spacesQuery } from "./queries";

/** What the HTML's first script left for the app (`early-html.ts`). */
export interface EarlyReads {
  readonly me: Promise<Response>;
  readonly spaces: Promise<Response | null>;
  readonly signUp: Promise<Response | null>;
}

/** The reads the HTML started, handed over once: the first screen joins them, any later one reads the API itself. */
export const takeEarlyReads = (): EarlyReads | null => {
  const holder = globalThis as { __hearthEarly?: EarlyReads };
  const reads = holder.__hearthEarly ?? null;
  delete holder.__hearthEarly;
  return reads;
};

/** An early read as the generated client answers one: the body as `data`, or as `error` when the API refused. */
export const earlyResult = async <T>(
  pending: Promise<Response>,
): Promise<{ data?: T; error?: unknown; response: Response }> => {
  const response = await pending;
  const body: unknown = await response.json().catch(() => undefined);
  return response.ok ? { data: body as T, response } : { error: body, response };
};

/**
 * The profile, spaces and sign-up mode queries start from the HTML's reads, so the guards, the shell and the sign-in
 * screen join them instead of reading again. Each answer is used once: a retry, or any later read of the same query,
 * asks the API itself. The spaces are read only for a signed-in person and the sign-up mode only for a visitor; when
 * the HTML's read of either failed on the network, the API is asked here.
 */
export const seedEarlyReads = (queryClient: QueryClient, apis: SpaApis, early: EarlyReads): void => {
  let me: Promise<Response> | null = early.me;
  void queryClient.prefetchQuery({
    ...meQuery(apis.sessionApi),
    queryFn: async () => {
      const pending = me;
      me = null;
      return meFrom(pending ? await earlyResult<MeDto>(pending) : await apis.sessionApi.GET("/api/v1/me"));
    },
  });
  // A profile read that failed on the network is the guard's to read again; no spaces are read for it here.
  void early.me.then(
    (answer) => {
      if (answer.status === 401) {
        let signUp: Promise<Response | null> | null = early.signUp;
        void queryClient.prefetchQuery({
          ...signUpModeQuery(apis.sessionApi),
          queryFn: async () => {
            const slot = signUp;
            signUp = null;
            // Ruling P143, as signUpModeQuery reads it: closed only when the API says so.
            try {
              const pending = slot ? await slot : null;
              return signUpModeFrom(
                pending
                  ? await earlyResult<{ signUp: "open" | "closed" }>(Promise.resolve(pending))
                  : await apis.sessionApi.GET("/api/v1/auth/sign-up"),
              );
            } catch {
              return "open";
            }
          },
        });
      }
      if (!answer.ok) return;
      let spaces: Promise<Response | null> | null = early.spaces;
      void queryClient.prefetchQuery({
        ...spacesQuery(apis.api),
        queryFn: async () => {
          // Taken before the wait, as the profile's is: a second run during it must not read the same answer.
          const slot = spaces;
          spaces = null;
          const pending = slot ? await slot : null;
          return spacesFrom(
            pending
              ? await earlyResult<{ items: SpaceDto[] }>(Promise.resolve(pending))
              : await apis.api.GET("/api/v1/spaces"),
          );
        },
      });
    },
    () => undefined,
  );
};

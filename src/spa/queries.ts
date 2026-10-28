import { queryOptions } from "@tanstack/react-query";
import type { Api } from "@/shared/ui/api/client";
import type { MeDto, SignUpMode, SpaceDto } from "@/shared/ui/api/dto";
import { meFrom, outcomeOf, signUpModeFrom } from "@/shared/ui/api/readers";

/**
 * ADR 0006: every read is a query keyed by module and parameters. The first key is the module; sign-out and a change of
 * person drop every key but `identity` and `i18n` (guards.ts).
 */
export const queryKeys = {
  me: ["identity", "me"] as const,
  signUpMode: ["identity", "sign-up-mode"] as const,
  spaces: ["spaces", "list"] as const,
};

/** The signed-in person, or null when the API answers 401; any other failure throws (ruling P145). */
export const meQuery = (api: Api) =>
  queryOptions<MeDto | null>({
    queryKey: queryKeys.me,
    queryFn: async () => meFrom(await api.GET("/api/v1/me")),
  });

/** Ruling P143: closed only when the API says so; a failed read answers open. */
export const signUpModeQuery = (api: Api) =>
  queryOptions<SignUpMode>({
    queryKey: queryKeys.signUpMode,
    queryFn: async () => {
      try {
        return signUpModeFrom(await api.GET("/api/v1/auth/sign-up"));
      } catch {
        return "open";
      }
    },
  });

/** The person's spaces; the shell cannot render without them, so a problem throws to the error screen. */
export const spacesQuery = (api: Api) =>
  queryOptions<SpaceDto[]>({
    queryKey: queryKeys.spaces,
    queryFn: async () => {
      const outcome = outcomeOf(await api.GET("/api/v1/spaces"));
      if (outcome.kind !== "ok") throw new Error(`Listing the spaces failed: ${outcome.kind}`);
      return outcome.data.items;
    },
  });

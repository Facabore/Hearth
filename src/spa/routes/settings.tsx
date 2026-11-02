import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { SettingsForm } from "@/modules/identity/ui";
import {
  activeSpaceOf,
  JoinByLinkForm,
  newSpaceBackHref,
  NewSpaceForm,
  spaceHomeHref,
  SpaceNameSection,
  type SpaceFlow,
} from "@/modules/spaces/ui";
import { NotFoundScreen } from "@/shared/ui";
import { useApis } from "../api";
import { meQuery, spacesQuery } from "../queries";
import { useTitle } from "../title";
import { ShellFrame, spaceFlowsSlot } from "./space-shell";

const settings = getRouteApi("/settings");
const newSpace = getRouteApi("/spaces/new");

/**
 * HU-E9-13: the Settings screen (the form renders its own heading). `?from=` is the space the person came from: Volver
 * returns to its home and, when it is one of hers, the shell around the screen is that space's (N3). #167: the same
 * space, the personal one without `?from=`, is the one its managers rename here.
 */
export function SettingsRoute() {
  useTitle(useTranslations("settings")("title"));
  const { from } = settings.useSearch();
  const { api, sessionApi } = useApis();
  const me = useSuspenseQuery(meQuery(sessionApi)).data;
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  const space = activeSpaceOf(spaces, null, from);
  if (!me || !space) return <NotFoundScreen />;
  return (
    <ShellFrame spaceId={null} from={from}>
      <div className="mx-auto flex max-w-[640px] flex-col gap-3 py-3">
        <SettingsForm me={me} backHref={spaceHomeHref(spaces, from)} />
        {/* Keyed by the space: another `?from=` starts the field afresh, its own rename's refresh does not. */}
        <SpaceNameSection key={space.id} space={space} />
      </div>
    </ShellFrame>
  );
}

/**
 * Ruling P272 (boards E9-05 · 07 and Pantallas nuevas · 11): the space switcher's own sheets, "Crear un espacio
 * compartido" and "Unirme con un enlace de invitación". They ride in this chunk, which already holds the create form,
 * and the shell loads it through the New space route only when the person opens one (`space-shell.tsx`).
 */
export function SpaceFlows({ flow, onDone }: { readonly flow: SpaceFlow; readonly onDone: () => void }) {
  return flow === "create" ? <NewSpaceForm onCreated={onDone} /> : <JoinByLinkForm onOpened={onDone} />;
}
spaceFlowsSlot.current = SpaceFlows;

/**
 * HU-E9-05: create a shared space (a name and a currency). Volver returns to the screen the create link started from
 * (`returnTo`); saving lands in the new space.
 */
export function NewSpaceRoute() {
  useTitle(useTranslations("spaces.new")("title"));
  const { from, returnTo } = newSpace.useSearch();
  const { api } = useApis();
  const spaces = useSuspenseQuery(spacesQuery(api)).data;
  return (
    <ShellFrame spaceId={null} from={from}>
      <div className="mx-auto max-w-[560px]">
        <NewSpaceForm backHref={newSpaceBackHref(spaces, from, returnTo)} />
      </div>
    </ShellFrame>
  );
}

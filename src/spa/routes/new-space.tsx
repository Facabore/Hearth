import { useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import { JoinByLinkForm, newSpaceBackHref, NewSpaceForm, type SpaceFlow } from "@/modules/spaces/ui";
import { useApis } from "../api";
import { spacesQuery } from "../queries";
import { useTitle } from "../title";
import { ShellFrame, spaceFlowsSlot } from "./space-shell";

const newSpace = getRouteApi("/spaces/new");

/**
 * Ruling P272 (boards E9-05 · 07 and Pantallas nuevas · 11): the space switcher's own sheets, "Crear un espacio
 * compartido" and "Unirme con un enlace de invitación". They ride in this chunk, which already holds the create form,
 * and the shell loads it through the New space route only when the person opens one (`space-shell.tsx`). Settings has
 * a chunk of its own (ruling P276): neither the shell's flows nor New space download its form or its copy.
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

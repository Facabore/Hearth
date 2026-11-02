import { getRouteApi } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import {
  RecurrenceDetail,
  RecurrenceForm,
  RecurringList,
  RecurringNotAllowed,
} from "@/modules/ledger/ui/screens";
import { controlsFor } from "@/modules/spaces/ui";
import { useApis } from "../api";
import { useRecurrence, useRecurrenceEdit, useRecurrenceForm, useRecurrences } from "../recurring/hooks";
import { useTitle } from "../title";
import { useViewer } from "../viewer";
import type { Viewer } from "../load";

const list = getRouteApi("/spaces/$spaceId/recurrences");
const create = getRouteApi("/spaces/$spaceId/recurrences/new");
const one = getRouteApi("/spaces/$spaceId/recurrences/$recurrenceId");
const edit = getRouteApi("/spaces/$spaceId/recurrences/$recurrenceId/edit");

/** HU-E9-09 (P270): the space's recurring movements, from the query cache (ADR 0006). */
export function RecurrencesRoute() {
  useTitle(useTranslations("recurrences")("title"));
  const viewer = useViewer(list.useParams().spaceId);
  const { recurrences, groups, accountNames, memberNames } = useRecurrences(viewer);
  return (
    <RecurringList
      space={viewer.space}
      recurrences={recurrences}
      groups={groups}
      accountNames={accountNames}
      memberNames={memberNames}
      formats={viewer.me.preferences.effective}
      timeZone={viewer.me.timezone}
    />
  );
}

/** HU-E9-09: define a recurrence; someone who cannot record in the space reads why instead (S6). */
export function NewRecurrenceRoute() {
  useTitle(useTranslations("recurrences.form")("title"));
  const viewer = useViewer(create.useParams().spaceId);
  if (!controlsFor(viewer.space.role, viewer.space.kind).recordMoney)
    return <RecurringNotAllowed space={viewer.space} />;
  return <NewRecurrence viewer={viewer} />;
}

function NewRecurrence({ viewer }: { readonly viewer: Viewer }) {
  const { api } = useApis();
  const { accounts, groups, meMemberId, shared, today } = useRecurrenceForm(viewer);
  return (
    <RecurrenceForm
      key={viewer.space.id}
      space={viewer.space}
      accounts={accounts}
      groups={groups}
      formats={viewer.me.preferences.effective}
      today={today}
      meMemberId={meMemberId}
      shared={shared}
      api={api}
    />
  );
}

/** HU-E9-09: one recurrence, its next dates and what may be done with it. */
export function RecurrenceRoute() {
  const { spaceId, recurrenceId } = one.useParams();
  const viewer = useViewer(spaceId);
  const { api } = useApis();
  const { recurrence, upcoming, groups, accountNames, memberNames, today } = useRecurrence(
    viewer,
    recurrenceId,
  );
  useTitle(recurrence.description);
  return (
    <RecurrenceDetail
      space={viewer.space}
      recurrence={recurrence}
      upcoming={upcoming}
      groups={groups}
      accountNames={accountNames}
      memberNames={memberNames}
      formats={viewer.me.preferences.effective}
      today={today}
      timeZone={viewer.me.timezone}
      api={api}
    />
  );
}

/** HU-E9-09: change a recurrence through PATCH; a viewer reads why she cannot. */
export function EditRecurrenceRoute() {
  useTitle(useTranslations("recurrences.form")("editTitle"));
  const { spaceId, recurrenceId } = edit.useParams();
  const viewer = useViewer(spaceId);
  if (!controlsFor(viewer.space.role, viewer.space.kind).recordMoney)
    return <RecurringNotAllowed space={viewer.space} />;
  return <EditRecurrence viewer={viewer} recurrenceId={recurrenceId} />;
}

function EditRecurrence({
  viewer,
  recurrenceId,
}: {
  readonly viewer: Viewer;
  readonly recurrenceId: string;
}) {
  const { api } = useApis();
  const { accounts, groups, meMemberId, today, recurrence } = useRecurrenceEdit(viewer, recurrenceId);
  return (
    <RecurrenceForm
      key={recurrence.id}
      space={viewer.space}
      accounts={accounts}
      groups={groups}
      formats={viewer.me.preferences.effective}
      today={today}
      meMemberId={meMemberId}
      api={api}
      edit={recurrence}
    />
  );
}

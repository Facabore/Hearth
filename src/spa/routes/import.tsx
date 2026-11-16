import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getRouteApi, useRouter } from "@tanstack/react-router";
import { useTranslations } from "use-intl";
import type { ImportPreviewDto, ImportResultDto } from "@/modules/portability/ui";
import {
  ImportAccountsScreen,
  ImportCategoriesScreen,
  ImportDoneScreen,
  ImportReviewScreen,
  MoneyManagerScreen,
} from "@/modules/portability/ui/screens";
import { personalSpaceOf } from "@/modules/spaces/ui";
import { useToast } from "@/shared/ui/molecules/toast";
import { nowIn } from "@/shared/ui/time/when";
import { useApis } from "../api";
import { importHistoryQuery, importKeys, importPreviewQuery } from "../portability/queries";
import { accountsQuery, categoriesQuery } from "../reads";
import { useTitle } from "../title";
import { useViewer } from "../viewer";

const moneyManager = getRouteApi("/spaces/$spaceId/data/money-manager");
const review = getRouteApi("/spaces/$spaceId/data/imports/$importId");
const accounts = getRouteApi("/spaces/$spaceId/data/imports/$importId/accounts");
const categories = getRouteApi("/spaces/$spaceId/data/imports/$importId/categories");
const done = getRouteApi("/spaces/$spaceId/data/imports/$importId/done");

/** The person, their personal space (where an import goes, design §3.2) and the flow's addresses. */
const useImportPlace = (spaceId: string, importId = "") => {
  const viewer = useViewer(spaceId);
  const hubHref = `/spaces/${spaceId}/data`;
  return {
    ...viewer,
    personal: personalSpaceOf(viewer.spaces),
    hubHref,
    reviewHref: `${hubHref}/imports/${importId}`,
    formats: viewer.me.preferences.effective,
    today: nowIn(new Date(), viewer.me.timezone).date,
  };
};

/** A draft the screens adjust: each accepted change's preview goes into the cache the review reads. */
const useDraft = (personalId: string, importId: string) => {
  const queryClient = useQueryClient();
  return {
    spaceId: personalId,
    importId,
    onAdjusted: (preview: ImportPreviewDto) =>
      void queryClient.setQueryData(importKeys.preview(personalId, importId), preview),
  };
};

/** D28, board 2: the file goes up, and its preview opens the review. */
export function MoneyManagerRoute() {
  useTitle(useTranslations("portability.moneyManager")("title"));
  const { spaceId } = moneyManager.useParams();
  const { personal, hubHref } = useImportPlace(spaceId);
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <MoneyManagerScreen
      backHref={hubHref}
      personal={personal}
      onUploaded={(preview) => {
        queryClient.setQueryData(importKeys.preview(personal.id, preview.id), preview);
        void queryClient.invalidateQueries({ queryKey: importKeys.history(personal.id) });
        void router.navigate({ href: `${hubHref}/imports/${preview.id}` });
      }}
    />
  );
}

/** D28, board 3: the draft's review; a confirm opens what it did, in place of the review. */
export function ImportReviewRoute() {
  useTitle(useTranslations("portability.review")("title"));
  const { spaceId, importId } = review.useParams();
  const { api } = useApis();
  const { me, personal, hubHref, reviewHref, formats, today } = useImportPlace(spaceId, importId);
  const preview = useSuspenseQuery(importPreviewQuery(api, personal.id, importId)).data;
  const draft = useDraft(personal.id, importId);
  const queryClient = useQueryClient();
  const router = useRouter();
  return (
    <ImportReviewScreen
      backHref={hubHref}
      base={reviewHref}
      preview={preview}
      formats={formats}
      today={today}
      timeZone={me.timezone}
      draft={draft}
      onConfirmed={(result: ImportResultDto) => {
        queryClient.setQueryData(importKeys.result(personal.id, importId), result);
        // The import touched accounts, categories, movements and balances, so every other read is read again when it
        // shows; this draft's own preview is left as it is, since asking for it again would be refused now.
        void queryClient.invalidateQueries({ predicate: (query) => query.queryKey[2] !== importId });
        void router.navigate({ href: `${reviewHref}/done`, replace: true });
      }}
    />
  );
}

/** D28, board 4: where each of the file's accounts goes. */
export function ImportAccountsRoute() {
  useTitle(useTranslations("portability.accounts")("title"));
  const { spaceId, importId } = accounts.useParams();
  const { api } = useApis();
  const { personal, reviewHref, formats } = useImportPlace(spaceId, importId);
  const preview = useSuspenseQuery(importPreviewQuery(api, personal.id, importId)).data;
  const list = useSuspenseQuery(accountsQuery(api, personal.id, "active")).data;
  const draft = useDraft(personal.id, importId);
  return (
    <ImportAccountsScreen
      backHref={reviewHref}
      preview={preview}
      accounts={list}
      formats={formats}
      draft={draft}
    />
  );
}

/** D28, board 5: where each of the file's categories goes. */
export function ImportCategoriesRoute() {
  useTitle(useTranslations("portability.categories")("title"));
  const { spaceId, importId } = categories.useParams();
  const { api } = useApis();
  const { personal, reviewHref, formats } = useImportPlace(spaceId, importId);
  const preview = useSuspenseQuery(importPreviewQuery(api, personal.id, importId)).data;
  const groups = useSuspenseQuery(categoriesQuery(api, personal.id, "active")).data;
  const draft = useDraft(personal.id, importId);
  return (
    <ImportCategoriesScreen
      backHref={reviewHref}
      preview={preview}
      groups={groups}
      formats={formats}
      draft={draft}
    />
  );
}

/**
 * D28, board 6: what the import did. This visit's confirm answer and the draft's preview name it fully; a later visit
 * reads its counts from the history. An undo goes back to Importar y exportar.
 */
export function ImportDoneRoute() {
  const t = useTranslations("portability");
  useTitle(t("done.title"));
  const { spaceId, importId } = done.useParams();
  const { api } = useApis();
  const { personal, hubHref, formats, today } = useImportPlace(spaceId, importId);
  const queryClient = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const history = useSuspenseQuery(importHistoryQuery(api, personal.id)).data;
  const summary = history.items.find((item) => item.id === importId);
  const result = queryClient.getQueryData<ImportResultDto>(importKeys.result(personal.id, importId));
  const preview =
    queryClient.getQueryData<ImportPreviewDto>(importKeys.preview(personal.id, importId)) ?? null;
  const personalHref = `/spaces/${personal.id}`;
  return (
    <ImportDoneScreen
      place={{
        hubHref,
        transactionsHref: `${personalHref}/transactions`,
        accountsHref: `${personalHref}/accounts`,
        categoriesHref: `${personalHref}/categories`,
        personal,
        importId,
      }}
      counts={result?.counts ?? summary?.counts ?? null}
      preview={preview}
      undoable={(result?.status ?? summary?.status) === "CONFIRMED"}
      formats={formats}
      today={today}
      onUndone={() => {
        toast.show({ message: t("hub.undone") });
        void queryClient.invalidateQueries();
        void router.navigate({ href: hubHref, replace: true });
      }}
    />
  );
}

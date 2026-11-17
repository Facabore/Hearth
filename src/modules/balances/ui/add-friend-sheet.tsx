"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Button, ProblemNotice, Sheet, TextField } from "@/shared/ui";
import { browserApi, type Api } from "@/shared/ui/api/client";
import { problemFrom, type Problem } from "@/shared/ui/api/problem";
import { friendLinkOf, handleOf, initialsOf, isHandle } from "./friends";

/** How long typing pauses before the @ is looked up: one lookup for the whole @, never one per letter (S3). */
const LOOKUP_DELAY_MS = 300;

/** Ruling P338: a guest's name is 1–200 characters (the guest name rules). */
const MAX_NAME = 200;

type Found = { readonly handle: string; readonly displayName: string };

/** What the "Usa Hearth" half shows for the @ typed so far. */
type Lookup =
  | { readonly kind: "idle" }
  | { readonly kind: "own" }
  | { readonly kind: "searching" }
  | { readonly kind: "notFound"; readonly handle: string }
  | { readonly kind: "tooMany" }
  | { readonly kind: "failed"; readonly problem: Problem }
  | { readonly kind: "found"; readonly person: Found };

type Sending = "idle" | "sending" | "sent" | "friends";

/**
 * Ruling P339 (board "Agregar amigo · por @usuario o por nombre"), opened by Amigos' "+". **Usa Hearth** finds someone
 * only by their exact @ (S3: no listing, no prefix search), looked up once typing pauses, and sends them a request,
 * which then says "Solicitud enviada"; when they had already asked the viewer, sending accepted theirs, so it says "Ya
 * son amigos" and opens the person. **No usa Hearth** adds a guest by name at once and opens their screen. Under both,
 * "Tú eres @…" shares the viewer's own link (`/f/<handle>`, S6), or offers to pick an @ to someone without one.
 */
export function AddFriendSheet({
  open,
  onOpenChange,
  personalSpaceId,
  myHandle,
  initialHandle = "",
  api: injected,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** The personal space, whose address the person screens keep. */
  readonly personalSpaceId: string;
  /** The viewer's own @, absent while they have none. */
  readonly myHandle?: string;
  /** An @ to look up at once: the one a friend link (`/f/<handle>`) carried. */
  readonly initialHandle?: string;
  readonly api?: Api;
}) {
  const t = useTranslations("friends.add");
  const common = useTranslations("common");
  const router = useRouter();
  const api = useMemo(() => injected ?? browserApi(), [injected]);
  const [typed, setTyped] = useState(initialHandle);
  const [answer, setAnswer] = useState<{ readonly handle: string; readonly lookup: Lookup } | null>(null);
  const [sent, setSent] = useState<{
    readonly handle: string;
    readonly state: Sending;
    readonly problem: Problem | null;
  } | null>(null);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [addProblem, setAddProblem] = useState<Problem | null>(null);
  const [shared, setShared] = useState<"copied" | "copyFailed" | null>(null);
  const handle = handleOf(typed);
  // The viewer's own @ answers nothing worth a lookup: the API would say nobody uses it.
  const searchable = isHandle(handle) && handle !== myHandle;
  const lookup: Lookup = !isHandle(handle)
    ? { kind: "idle" }
    : handle === myHandle
      ? { kind: "own" }
      : answer?.handle === handle
        ? answer.lookup
        : { kind: "searching" };
  // What was sent belongs to the @ it was sent to: typing another one starts again.
  const sending: Sending = sent?.handle === handle ? sent.state : "idle";
  const sendProblem = sent?.handle === handle ? sent.problem : null;
  const personHref = (spaceId: string) => `/spaces/${personalSpaceId}/friends/${spaceId}`;

  useEffect(() => {
    if (!searchable) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        let next: Lookup;
        try {
          const { data, error, response } = await api.GET("/api/v1/users/by-handle/{handle}", {
            params: { path: { handle } },
          });
          if (data) next = { kind: "found", person: data };
          else if (response.status === 404) next = { kind: "notFound", handle };
          else if (response.status === 429) next = { kind: "tooMany" };
          else next = { kind: "failed", problem: problemFrom(error, response) };
        } catch (error) {
          next = { kind: "failed", problem: problemFrom(error, undefined) };
        }
        // A slower answer for an @ typed before never replaces the newer one.
        if (live) setAnswer({ handle, lookup: next });
      })();
    }, LOOKUP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, handle, searchable]);

  const send = async (person: Found) => {
    const to = handle;
    setSent({ handle: to, state: "sending", problem: null });
    let problem: Problem;
    try {
      const { data, error, response } = await api.POST("/api/v1/me/friend-requests", {
        body: { handle: person.handle },
      });
      if (data) {
        router.refresh();
        if (data.status === "ACCEPTED" && data.spaceId) {
          setSent({ handle: to, state: "friends", problem: null });
          onOpenChange(false);
          router.push(personHref(data.spaceId));
        } else setSent({ handle: to, state: "sent", problem: null });
        return;
      }
      problem = problemFrom(error, response);
    } catch (error) {
      problem = problemFrom(error, undefined);
    }
    setSent({ handle: to, state: "idle", problem });
  };

  const addGuest = async (event: FormEvent) => {
    event.preventDefault();
    setAdding(true);
    setAddProblem(null);
    try {
      const { data, error, response } = await api.POST("/api/v1/me/friends", {
        body: { displayName: name.trim() },
      });
      if (data) {
        onOpenChange(false);
        router.push(personHref(data.spaceId));
        return;
      }
      setAddProblem(problemFrom(error, response));
    } catch (error) {
      setAddProblem(problemFrom(error, undefined));
    }
    setAdding(false);
  };

  const share = async () => {
    if (!myHandle) return;
    const link = `${window.location.origin}${friendLinkOf(myHandle)}`;
    try {
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ text: t("shareText"), url: link });
          return;
        } catch (error) {
          // The person closed the share sheet: nothing to say. Any other refusal falls back to copying.
          if (error instanceof DOMException && error.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(link);
      setShared("copied");
    } catch {
      setShared("copyFailed");
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("title")}>
      <div className="flex flex-col gap-5">
        <section className="flex flex-col gap-2">
          <TextField
            id="add-friend-handle"
            label={t("hearth")}
            leading="@"
            value={typed}
            maxLength={64}
            placeholder={t("handlePlaceholder")}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
          <div aria-live="polite" className="flex flex-col gap-2">
            {lookup.kind === "searching" ? <p className="text-sm text-muted">{t("searching")}</p> : null}
            {lookup.kind === "notFound" ? (
              <p className="text-sm text-ink">{t("notFound", { handle: lookup.handle })}</p>
            ) : null}
            {lookup.kind === "tooMany" ? <p className="text-sm text-ink">{t("tooMany")}</p> : null}
            {lookup.kind === "own" ? <ProblemNotice problem={ownHandle} /> : null}
            {lookup.kind === "failed" ? <ProblemNotice problem={lookup.problem} /> : null}
            {lookup.kind === "found" ? (
              <div className="flex flex-wrap items-center gap-3">
                {/* Amigos' avatar, drawn here: importing it would count Amigos' row helpers in this sheet's chunk. */}
                <span
                  aria-hidden="true"
                  className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent"
                >
                  {initialsOf(lookup.person.displayName)}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium [overflow-wrap:anywhere] text-ink">
                    {lookup.person.displayName}
                  </span>
                  <span className="text-[13px] [overflow-wrap:anywhere] text-muted">
                    @{lookup.person.handle}
                  </span>
                </span>
                {sending === "sent" || sending === "friends" ? (
                  <span className="text-sm font-semibold text-accent">
                    {t(sending === "sent" ? "sent" : "already")}
                  </span>
                ) : (
                  <Button
                    size="md"
                    className="ml-auto"
                    disabled={sending === "sending"}
                    onClick={() => void send(lookup.person)}
                  >
                    {t("send")}
                  </Button>
                )}
              </div>
            ) : null}
            {sendProblem ? (
              // The lookups' own throttle, in its own words: never the sign-in throttle's message.
              sendProblem.status === 429 ? (
                <p className="text-sm text-ink">{t("tooMany")}</p>
              ) : (
                <ProblemNotice problem={sendProblem} />
              )
            ) : null}
          </div>
          <p className="text-sm text-muted">{t("note")}</p>
        </section>
        <form className="flex flex-col gap-2" onSubmit={(event) => void addGuest(event)}>
          <TextField
            id="add-friend-name"
            label={t("guest")}
            value={name}
            maxLength={MAX_NAME}
            required
            placeholder={t("namePlaceholder")}
            autoComplete="off"
            hint={t("guestNote")}
            onChange={(event) => setName(event.target.value)}
          />
          {addProblem ? <ProblemNotice problem={addProblem} /> : null}
          <Button type="submit" variant="secondary" size="md" disabled={adding || name.trim() === ""}>
            {t("addGuest")}
          </Button>
        </form>
        {myHandle ? (
          <div className="flex flex-col gap-1">
            <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 rounded-[14px] bg-accent-soft py-1 pr-1 pl-4">
              <span className="font-semibold [overflow-wrap:anywhere] text-accent">
                {t("you", { handle: myHandle })}
              </span>
              <Button variant="ghost" size="compact" className="px-4" onClick={() => void share()}>
                {t("share")}
              </Button>
            </div>
            <p role="status" className="text-sm text-muted">
              {shared ? common(shared) : null}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 rounded-[14px] bg-accent-soft p-4">
            <Link
              href={`/settings?from=${personalSpaceId}`}
              className="inline-flex min-h-11 items-center font-semibold text-accent"
              onClick={() => onOpenChange(false)}
            >
              {t("pickHandle")}
            </Link>
            <p className="text-sm text-ink">{t("pickHandleNote")}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

/** The viewer typed their own @: said as the API would say it to a request (S4). */
const ownHandle: Problem = { code: "OwnHandle", status: 422, requestId: null, errors: [], field: null };

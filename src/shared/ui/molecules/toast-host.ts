import { TOAST_ACTION_MS, TOAST_MS } from "./toast-timing";
import type { ToastInput } from "./toast-input";

/**
 * Ruling P195: the visible toast, its two buttons and its timer, in plain DOM inside the live regions that
 * `ToastProvider` rendered on the server. `toast.ts` loads this module with the first toast only. It uses no React and
 * imports no module the screens share: a second root, or a shared component, makes the bundler cut another shared
 * chunk that every signed-in route would download (about 0.7 KiB, P198).
 */

/** What is left of a paused toast is never shorter than this, so the person can still read and reach it. */
const MIN_RESUMED_MS = 1_000;
/** The ghost `compact` and `iconCompact` variants of `Button`: 44 px targets with accent text. */
const GHOST =
  "inline-flex shrink-0 items-center justify-center gap-2 bg-transparent font-semibold text-accent";
const SVG = "http://www.w3.org/2000/svg";

let dismissCurrent: (() => void) | undefined;

export const dismissToast = (): void => dismissCurrent?.();

const element = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const closeIcon = (): SVGSVGElement => {
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    width: "24",
    height: "24",
    viewBox: "0 0 24 24",
    fill: "none",
    "aria-hidden": "true",
  }))
    svg.setAttribute(name, value);
  const path = document.createElementNS(SVG, "path");
  for (const [name, value] of Object.entries({
    d: "M6 6l12 12M18 6 6 18",
    stroke: "currentColor",
    "stroke-width": "1.75",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    path.setAttribute(name, value);
  svg.append(path);
  return svg;
};

/** One toast at a time: a new one replaces the current one, in the region of its tone. */
export const showToast = (toast: ToastInput): void => {
  const region = document.querySelector<HTMLElement>("[data-toast-region]");
  const target = region?.querySelector(`[data-toast="${toast.tone === "alert" ? "alert" : "status"}"]`);
  if (!region || !target) return;
  dismissToast();

  const card = element(
    "div",
    "pointer-events-auto flex min-h-14 w-full items-center gap-1 rounded-2xl border border-line bg-surface py-1 pr-1 pl-4 text-ink shadow-lg",
  );
  card.tabIndex = -1;
  card.setAttribute("data-testid", "toast");
  card.append(element("p", "min-w-0 flex-1 py-2 [overflow-wrap:anywhere]", toast.message));

  let timer: ReturnType<typeof setTimeout> | undefined;
  let remaining = 0;
  let startedAt = 0;
  let paused = false;
  let closed = false;
  const holds = { pointer: false, focus: false };
  const dismiss = (): void => {
    closed = true;
    clearTimeout(timer);
    window.removeEventListener("keydown", onWindowKey);
    card.remove();
    if (dismissCurrent === dismiss) dismissCurrent = undefined;
  };
  const start = (ms: number): void => {
    clearTimeout(timer);
    remaining = ms;
    startedAt = Date.now();
    timer = setTimeout(dismiss, ms);
  };
  // The pointer and the focus each hold the toast; it runs only while neither does (WCAG 2.2.1).
  const hold = (by: "pointer" | "focus", on: boolean): void => {
    holds[by] = on;
    const held = holds.pointer || holds.focus;
    if (held && !paused) {
      paused = true;
      clearTimeout(timer);
      remaining -= Date.now() - startedAt;
    } else if (!held && paused) {
      paused = false;
      start(Math.max(remaining, MIN_RESUMED_MS));
    }
  };
  // F8 reaches the toast without a long tab walk, the convention Radix's toast viewport uses.
  const onWindowKey = (event: KeyboardEvent): void => {
    if (event.key === "F8") card.focus();
  };

  const { action } = toast;
  if (action) {
    const button = element("button", `${GHOST} h-11 rounded-[14px] px-2 text-sm`, action.label);
    button.type = "button";
    button.addEventListener("click", () => {
      // A double tap runs the action once: the first tap closes the toast.
      if (closed) return;
      dismiss();
      action.onAction();
    });
    card.append(button);
  }
  const close = element("button", `${GHOST} size-11 rounded-[14px]`);
  close.type = "button";
  close.addEventListener("click", dismiss);
  close.append(closeIcon(), element("span", "sr-only", region.dataset.dismiss ?? ""));
  card.append(close);

  card.addEventListener("pointerenter", () => hold("pointer", true));
  card.addEventListener("pointerleave", () => hold("pointer", false));
  card.addEventListener("focusin", () => hold("focus", true));
  card.addEventListener("focusout", (event) => {
    if (!card.contains(event.relatedTarget as Node | null)) hold("focus", false);
  });
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
  });
  window.addEventListener("keydown", onWindowKey);

  dismissCurrent = dismiss;
  target.append(card);
  start(action ? TOAST_ACTION_MS : TOAST_MS);
};

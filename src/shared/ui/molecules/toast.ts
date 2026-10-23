import type { ToastInput } from "./toast-input";
import { TOAST_ACTION_MS, TOAST_MS } from "./toast-timing";

export { TOAST_ACTION_MS, TOAST_MS };
export type { ToastInput };

export interface ToastApi {
  readonly show: (toast: ToastInput) => void;
  readonly dismiss: () => void;
}

type Host = typeof import("./toast-host");
let host: Host | undefined;

const withHost = (run: (loaded: Host) => void): void => {
  if (host) run(host);
  else
    void import("./toast-host").then((module) => {
      host = module;
      run(module);
    });
};

const api: ToastApi = {
  /**
   * The card, its buttons and its timer load with the first toast only (P198: the record route's budget), and the
   * regions it shows in are the server-rendered ones of `ToastProvider`: outside them, showing a toast does nothing.
   */
  show: (toast) => withHost((loaded) => loaded.showToast(toast)),
  dismiss: () => host?.dismissToast(),
};

/** Ruling P195: the toasts of the signed-in screens. */
export const useToast = (): ToastApi => api;

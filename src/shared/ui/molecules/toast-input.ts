export interface ToastInput {
  readonly message: string;
  /** "alert" only for a failure (WCAG 4.1.3); a success is a status. */
  readonly tone?: "status" | "alert";
  readonly action?: { readonly label: string; readonly onAction: () => void };
}

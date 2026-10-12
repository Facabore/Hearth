export interface DomainError {
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export const domainError = (code: string, details?: Record<string, unknown>): DomainError =>
  details === undefined ? { code } : { code, details };

/** The signed-in user a request acts as. */
export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly locale: string;
  readonly timezone: string;
}

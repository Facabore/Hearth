import { currencyOf } from "./currency";
import { domainError } from "./domain-error";
import { err, flatMap, ok, type Result } from "./result";

const PLAIN_DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * D30: how many units of `quote` one unit of `base` is worth, as an exact decimal. The value is kept as a scaled
 * integer (`units` / 10^`scale`), never as a float, so a stored rate converts the same way everywhere.
 */
export class ExchangeRate {
  private constructor(
    readonly base: string,
    readonly quote: string,
    /** The rate's digits as an integer: the value is `units / 10^scale`. */
    readonly units: bigint,
    readonly scale: number,
  ) {}

  /** A positive plain decimal such as "4100.25" between two different known currencies. */
  static of(base: string, quote: string, value: string): Result<ExchangeRate> {
    return flatMap(currencyOf(base), () =>
      flatMap(currencyOf(quote), () => {
        const match = value.match(PLAIN_DECIMAL);
        if (!match || base === quote) return err(domainError("InvalidExchangeRate", { base, quote, value }));
        const [, whole, fraction = ""] = match;
        const trimmed = fraction.replace(/0+$/, "");
        const units = BigInt(`${whole}${trimmed}`);
        if (units === 0n) return err(domainError("InvalidExchangeRate", { base, quote, value }));
        return ok(new ExchangeRate(base, quote, units, trimmed.length));
      }),
    );
  }

  /** The rate as written for storage and the wire: a plain decimal without trailing zeros. */
  get value(): string {
    const digits = this.units.toString().padStart(this.scale + 1, "0");
    const whole = digits.slice(0, digits.length - this.scale);
    const fraction = digits.slice(digits.length - this.scale);
    return fraction ? `${whole}.${fraction}` : whole;
  }
}

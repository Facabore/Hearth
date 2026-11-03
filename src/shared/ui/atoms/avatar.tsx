/**
 * A person's initial; decorative, the name is always written next to it. `dark` is the profile's own, filled with ink
 * (boards B1 · 03, 05 and 06, P292); every other person keeps the soft tint.
 */
export function Avatar({
  name,
  size = 40,
  tone = "soft",
}: {
  readonly name: string;
  readonly size?: number;
  readonly tone?: "soft" | "dark";
}) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${tone === "dark" ? "bg-ink text-surface" : "bg-accent-soft text-accent"}`}
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

/** A person's initial; decorative, the name is always written next to it. */
export function Avatar({ name, size = 40 }: { readonly name: string; readonly size?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent"
    >
      {name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent",
        secondary: "border border-line bg-surface text-ink",
        ghost: "bg-transparent text-accent",
        danger: "border border-danger bg-surface text-danger",
        dangerGhost: "bg-transparent text-danger",
      },
      // Every size sets its own radius and box, so no class ever overrides another: the shared `cn` no longer
      // resolves conflicting utilities (tailwind-merge was about 9 KiB of script on every route, P134).
      size: {
        lg: "h-14 w-full rounded-[14px] px-6 text-base",
        /** `lg` for a label that may wrap: it grows with its text. */
        lgFlow: "h-auto w-full rounded-[14px] px-6 text-base",
        md: "h-12 rounded-[14px] px-5 text-base",
        compact: "h-11 rounded-[14px] px-2 text-sm",
        chip: "h-11 rounded-full px-4 text-sm",
        icon: "size-12 rounded-[14px]",
        iconCompact: "size-11 rounded-[14px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { readonly asChild?: boolean };

/**
 * The canvas's buttons: `lg` is a form's main action (56 px), `md` 48 px, `icon` 48 × 48; `compact` and `chip` are
 * 44 px, `iconCompact` 44 × 44. `className` only adds classes (it cannot override a variant's): pick the variant.
 */
export function Button({ variant, size, asChild = false, className, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot.Root : "button";
  return (
    <Component
      className={cn(button({ variant, size }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}

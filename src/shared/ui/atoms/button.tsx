import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-[14px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-accent text-on-accent",
        secondary: "border border-line bg-surface text-ink",
        ghost: "bg-transparent text-accent",
        danger: "border border-danger bg-surface text-danger",
      },
      size: { lg: "h-14 w-full px-6 text-base", md: "h-12 px-5 text-base", icon: "size-12" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { readonly asChild?: boolean };

/** The canvas's buttons: `lg` is a form's main action (56 px), `md` 48 px, `icon` 48 × 48. */
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

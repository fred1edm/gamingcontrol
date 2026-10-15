import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 disabled:pointer-events-none disabled:opacity-40 min-h-11 px-4",
  {
    variants: {
      variant: {
        default: "bg-emerald-300 text-slate-950 hover:bg-emerald-200",
        outline:
          "border border-white/15 bg-white/5 text-slate-100 hover:bg-white/10",
        ghost: "text-slate-400 hover:bg-white/5 hover:text-white",
        destructive: "bg-red-500/15 text-red-300 hover:bg-red-500/25",
      },
    },
    defaultVariants: { variant: "default" },
  },
);
export function Button({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, className }))} {...props} />
  );
}

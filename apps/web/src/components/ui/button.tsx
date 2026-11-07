// Adapted from shadcn/ui (MIT), new-york-v4 registry, 2026-11-04.
// Source: https://ui.shadcn.com/r/styles/new-york-v4/button.json
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { LoaderCircle } from "lucide-react";
import { Slot } from "radix-ui";
import { buttonVariants } from "./button-variants";

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  busy = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    busy?: boolean;
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? (
        <>
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          Memproses…
        </>
      ) : (
        children
      )}
    </Comp>
  );
}

export { Button };

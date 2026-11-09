// Adapted from shadcn/ui (MIT), new-york-v4 registry, 2026-11-08.
// Source: https://ui.shadcn.com/r/styles/new-york-v4/textarea.json

import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-(--control-height) w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none field-sizing-content placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:pointer-fine:text-sm dark:bg-input/30",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };

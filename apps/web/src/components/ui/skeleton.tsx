// Adapted from shadcn/ui (MIT), new-york-v4 registry, 2026-11-04.
// Source: https://ui.shadcn.com/r/styles/new-york-v4/skeleton.json
import { cn } from "@/lib/utils";

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-accent", className)}
      {...props}
    />
  );
}

export { Skeleton };

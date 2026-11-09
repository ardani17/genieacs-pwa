// Tabs list variant classes (split from tabs.tsx so the component
// file exports components only). Adapted from shadcn/ui (MIT),
// new-york-v4 registry, 2026-11-04.
import { cva } from "class-variance-authority";

export const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:min-h-(--control-height) group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

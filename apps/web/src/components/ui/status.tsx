import { CheckCircle2, CircleHelp, TriangleAlert } from "lucide-react";
import { Badge } from "./badge";
import { cn } from "@/lib/utils";
export type StatusTone = "success" | "warning" | "danger" | "muted";
const tones = {
  success: "border-success/20 bg-success/5 text-success",
  warning: "border-warning/20 bg-warning/5 text-warning",
  danger: "border-destructive/20 bg-destructive/5 text-destructive",
  muted: "border-border bg-muted text-muted-foreground",
};
export function Status({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  const Icon =
    tone === "success"
      ? CheckCircle2
      : tone === "muted"
        ? CircleHelp
        : TriangleAlert;
  return (
    <Badge
      variant="outline"
      className={cn(
        "max-w-full gap-2 whitespace-normal px-3 py-2 text-xs leading-relaxed",
        tones[tone],
      )}
      role="status"
      aria-live="polite"
    >
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </Badge>
  );
}

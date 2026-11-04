"use client";
import { CircleHelp, Inbox, ShieldAlert, TriangleAlert } from "lucide-react";
import { Button } from "./button";
import { Alert, AlertDescription, AlertTitle } from "./alert";
import { Card, CardContent } from "./card";
import { Skeleton } from "./skeleton";
export interface DataViewProps<T> {
  state:
    | "loading"
    | "empty"
    | "error"
    | "permission-denied"
    | "unavailable"
    | "ready";
  errorRequestId?: string;
  onRetry?: () => void;
  emptyAction?: React.ReactNode;
  renderReady: (items: T[]) => React.ReactNode;
  items: T[];
}
export function DataView<T>({
  state,
  errorRequestId,
  onRetry,
  emptyAction,
  renderReady,
  items,
}: DataViewProps<T>) {
  if (state === "loading")
    return (
      <Card role="status" aria-busy="true">
        <CardContent className="space-y-4">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <span className="sr-only">Memuat data…</span>
        </CardContent>
      </Card>
    );
  if (state === "ready") return <>{renderReady(items)}</>;
  if (state === "empty")
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          <Inbox className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-medium">Belum ada data.</p>
          {emptyAction}
        </CardContent>
      </Card>
    );
  const denied = state === "permission-denied";
  const unavailable = state === "unavailable";
  const Icon = denied ? ShieldAlert : unavailable ? CircleHelp : TriangleAlert;
  return (
    <Alert variant={unavailable ? "default" : "destructive"}>
      <Icon aria-hidden="true" />
      <AlertTitle>
        {denied
          ? "Akses tidak diizinkan."
          : unavailable
            ? "Data belum tersedia."
            : "Data tidak dapat dimuat."}
      </AlertTitle>
      <AlertDescription>
        {errorRequestId ? (
          <p className="break-all">request {errorRequestId}</p>
        ) : null}
        {onRetry && !denied ? (
          <Button variant="outline" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

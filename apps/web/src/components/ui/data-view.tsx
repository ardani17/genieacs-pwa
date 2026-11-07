"use client";

import { Button } from "./button";
import styles from "./ui.module.css";

export interface DataViewProps<T> {
  state: "loading" | "empty" | "error" | "ready";
  errorRequestId?: string;
  onRetry?: () => void;
  emptyAction?: React.ReactNode;
  renderReady: (items: T[]) => React.ReactNode;
  items: T[];
}

// DataView owns the four states explicitly — "empty" is NEVER inferred
// from an empty array while loading. Error output carries the request
// id for diagnosis without leaking payload data.
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
      <div className={styles.dataView} aria-busy="true" role="status">
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
        <div className={styles.skeleton} aria-hidden="true" />
        <span className="sr-only">Memuat data…</span>
      </div>
    );

  if (state === "error")
    return (
      <div className={styles.dataView} role="alert">
        <p>Data tidak dapat dimuat.</p>
        {errorRequestId ? <small>request {errorRequestId}</small> : null}
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Coba lagi
          </Button>
        ) : null}
      </div>
    );

  if (state === "empty")
    return (
      <div className={styles.dataView}>
        <p>Belum ada data.</p>
        {emptyAction}
      </div>
    );

  return <>{renderReady(items)}</>;
}

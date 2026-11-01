import styles from "./ui.module.css";

export type StatusTone = "success" | "warning" | "danger" | "muted";

const ICONS: Record<StatusTone, string> = {
  success: "M8 1.5 2.5 7l2 2L8 5.5 14 11.5l2-2z",
  warning: "M9 1 1 15h16L9 1zm-1 5h2v5H8V6zm0 6h2v2H8v-2z",
  danger: "M9 1 1 15h16L9 1zM8 6h2v5H8V6zm0 6h2v2H8v-2z",
  muted: "M9 1a8 8 0 1 0 0 16A8 8 0 0 0 9 1zm0 2a6 6 0 1 1 0 12A6 6 0 0 1 9 3z",
};

// Status = icon + text, announced politely; inline SVG is local with
// aria-hidden (the text carries the meaning).
export function Status({
  tone,
  children,
}: {
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`${styles.statusRow} ${
        tone === "danger" ? styles.dangerText : styles[tone]
      }`}
      role="status"
      aria-live="polite"
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 18 18"
        aria-hidden="true"
        focusable="false"
      >
        <path fill="currentColor" d={ICONS[tone]} />
      </svg>
      <span className={styles.statusText}>{children}</span>
    </span>
  );
}

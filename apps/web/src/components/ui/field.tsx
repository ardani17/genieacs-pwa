"use client";

import { useId } from "react";
import styles from "./ui.module.css";

export interface FieldProps {
  label: string;
  required?: boolean;
  error?: string;
  children: (ids: {
    id: string;
    describedBy: string | undefined;
    errorClass: string | undefined;
  }) => React.ReactNode;
}

// Accessible form field: explicit htmlFor/id pairing, error text wired
// through aria-describedby, required marker on the label itself.
export function Field({ label, required, error, children }: FieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? " *" : null}
      </label>
      {children({
        id,
        describedBy: error ? errorId : undefined,
        errorClass: error ? styles.inputError : undefined,
      })}
      {error ? (
        <p className={styles.errorText} id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

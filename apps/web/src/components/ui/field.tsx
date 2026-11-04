"use client";

import { useId } from "react";
import { Label } from "./label";

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
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {required ? " *" : null}
      </Label>
      {children({
        id,
        describedBy: error ? errorId : undefined,
        errorClass: error ? "border-destructive" : undefined,
      })}
      {error ? (
        <p className="text-sm text-destructive" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
